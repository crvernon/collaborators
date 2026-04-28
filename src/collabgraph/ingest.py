"""Neo4j ingestion of collaborator/affiliation/sector data.

All writes use ``MERGE`` so repeated ingestion creates-or-updates
nodes and relationships rather than duplicating them.
"""

from __future__ import annotations

import math
from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any

import pandas as pd
from neo4j import GraphDatabase

from collabgraph.schema import all_schema_statements

_INGEST_CYPHER: str = """
UNWIND $rows AS r
MERGE (a:Affiliation {name: r.affiliation})
  SET a.address   = r.address,
      a.latitude  = r.latitude,
      a.longitude = r.longitude,
      a.crs       = r.crs
MERGE (s:Sector {name: r.sector})
MERGE (c:Collaborator {name: r.collaborator})
MERGE (c)-[:AFFILIATED_WITH]->(a)
MERGE (c)-[:WORKS_IN]->(s)
MERGE (s)-[:PRESENT_AT]->(a)
"""


def _clean_value(value: Any) -> Any:
    """Convert pandas/NaN sentinels to ``None`` for the Neo4j driver."""
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


class Neo4jIngestor(AbstractContextManager["Neo4jIngestor"]):
    """Idempotent ingester for the collaborator graph.

    Usage::

        with Neo4jIngestor(uri, user, password) as ing:
            ing.init_schema()
            ing.ingest(df)
    """

    def __init__(
        self,
        uri: str,
        user: str,
        password: str,
        database: str = "neo4j",
    ) -> None:
        self.uri = uri
        self.database = database
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying Neo4j driver."""
        self.driver.close()

    def verify_connectivity(self) -> None:
        """Raise if the driver cannot reach the database."""
        self.driver.verify_connectivity()

    def init_schema(self) -> None:
        """Create uniqueness constraints and indexes (idempotent)."""
        with self.driver.session(database=self.database) as session:
            for statement in all_schema_statements():
                session.run(statement)

    def ingest(self, df: pd.DataFrame) -> int:
        """Upsert all rows of ``df`` into Neo4j.

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
        with self.driver.session(database=self.database) as session:
            session.run(_INGEST_CYPHER, rows=rows)
        return len(rows)

    def clear(self) -> None:
        """Delete every node and relationship in the database. Use with care."""
        with self.driver.session(database=self.database) as session:
            session.run("MATCH (n) DETACH DELETE n")
