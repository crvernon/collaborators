"""Kuzu ingestion of collaborator/affiliation/sector data.

All writes use ``MERGE`` so repeated ingestion creates-or-updates
nodes and relationships rather than duplicating them.
"""

from __future__ import annotations

import math
from contextlib import AbstractContextManager
from pathlib import Path
from types import TracebackType
from typing import Any

import kuzu
import pandas as pd

from collabgraph.schema import (
    NODE_TABLE_STATEMENTS,
    REL_TABLE_STATEMENTS,
    all_schema_statements,
)

_MERGE_AFFILIATIONS = (
    "UNWIND $rows AS r MERGE (a:Affiliation {name: r.affiliation})"
)

_MERGE_SECTORS = "UNWIND $rows AS r MERGE (s:Sector {name: r.sector})"

_MERGE_COLLABORATORS = (
    "UNWIND $rows AS r MERGE (c:Collaborator {name: r.collaborator})"
)

_MERGE_AFFILIATED_WITH = """
UNWIND $rows AS r
MATCH (c:Collaborator {name: r.collaborator}),
      (a:Affiliation  {name: r.affiliation})
MERGE (c)-[:AFFILIATED_WITH]->(a)
"""

_MERGE_WORKS_IN = """
UNWIND $rows AS r
MATCH (c:Collaborator {name: r.collaborator}),
      (s:Sector       {name: r.sector})
MERGE (c)-[:WORKS_IN]->(s)
"""

_MERGE_PRESENT_AT = """
UNWIND $rows AS r
MATCH (s:Sector       {name: r.sector}),
      (a:Affiliation  {name: r.affiliation})
MERGE (s)-[:PRESENT_AT]->(a)
"""

_AFFILIATION_PROPS: tuple[str, ...] = ("address", "latitude", "longitude", "crs")


def _clean_value(value: Any) -> Any:
    """Convert pandas/NaN sentinels to ``None`` for the Kuzu driver."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NA:
        return None
    return value


def _frame_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Render a DataFrame as a list of plain-Python dicts (NaN -> None)."""
    records = df.to_dict(orient="records")
    cleaned: list[dict[str, Any]] = []
    for row in records:
        cleaned.append({key: _clean_value(val) for key, val in row.items()})
    return cleaned


def _existing_table_names(conn: kuzu.Connection) -> set[str]:
    """Return the set of node/rel table names already declared in the DB."""
    df = conn.execute("CALL show_tables() RETURN *").get_as_df()
    if "name" not in df.columns:
        return set()
    return {str(n) for n in df["name"].tolist()}


class Ingestor(AbstractContextManager["Ingestor"]):
    """Idempotent ingester for the collaborator graph backed by Kuzu.

    Usage::

        with Ingestor("data/collabgraph.kuzu") as ing:
            ing.init_schema()
            ing.ingest(df)
    """

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = kuzu.Database(str(self.db_path))
        self.conn = kuzu.Connection(self.db)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        """Release the embedded database handle.

        Kuzu's Python bindings free the connection/database when their
        Python objects are garbage-collected; this is provided as a
        symmetric counterpart to :meth:`__init__`.
        """
        self.conn = None  # type: ignore[assignment]
        self.db = None  # type: ignore[assignment]

    def verify_connectivity(self) -> None:
        """Raise if the embedded database can't be queried."""
        self.conn.execute("RETURN 1 AS ok")

    def init_schema(self) -> None:
        """Create node/rel tables (idempotent)."""
        existing = _existing_table_names(self.conn)
        for table_name, ddl in all_schema_statements():
            if table_name in existing:
                continue
            self.conn.execute(ddl)

    def ingest(self, df: pd.DataFrame) -> int:
        """Upsert all rows of ``df`` into Kuzu.

        Parameters
        ----------
        df
            DataFrame produced by :func:`collabgraph.loader.read_collaborators`.

        Returns
        -------
        int
            Number of input rows written.
        """
        rows = _frame_to_records(df)
        if not rows:
            return 0

        for stage in (
            _MERGE_AFFILIATIONS,
            _MERGE_SECTORS,
            _MERGE_COLLABORATORS,
            _MERGE_AFFILIATED_WITH,
            _MERGE_WORKS_IN,
            _MERGE_PRESENT_AT,
        ):
            self.conn.execute(stage, {"rows": rows})

        for prop in _AFFILIATION_PROPS:
            prop_rows = [
                {"affiliation": r["affiliation"], "value": r.get(prop)}
                for r in rows
                if r.get(prop) is not None and r.get("affiliation") is not None
            ]
            if not prop_rows:
                continue
            self.conn.execute(
                f"UNWIND $rows AS r "
                f"MATCH (a:Affiliation {{name: r.affiliation}}) "
                f"SET a.{prop} = r.value",
                {"rows": prop_rows},
            )

        return len(rows)

    def clear(self) -> None:
        """Delete every node and relationship in the database. Use with care.

        Kuzu does not support an unconstrained ``MATCH (n) DETACH DELETE n``
        across all node tables, so we delete relationships first (per rel
        table) and then nodes (per node table).
        """
        existing = _existing_table_names(self.conn)
        for rel_name, _ in REL_TABLE_STATEMENTS:
            if rel_name in existing:
                self.conn.execute(f"MATCH ()-[r:{rel_name}]->() DELETE r")
        for node_name, _ in NODE_TABLE_STATEMENTS:
            if node_name in existing:
                self.conn.execute(f"MATCH (n:{node_name}) DELETE n")
