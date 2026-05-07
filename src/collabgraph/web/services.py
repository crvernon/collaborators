"""Service-layer helpers shared by the FastAPI routes (Kuzu-backed)."""

from __future__ import annotations

import math
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import kuzu
import pandas as pd

from collabgraph.config import Settings, load_settings


def get_settings() -> Settings:
    """Load settings from environment / .env file."""
    return load_settings()


@contextmanager
def kuzu_connection(settings: Settings | None = None) -> Iterator[kuzu.Connection]:
    """Yield a Kuzu connection bound to the configured DB path.

    The underlying ``kuzu.Database`` and ``kuzu.Connection`` objects are
    cleaned up when this context manager exits (Kuzu's Python bindings
    release their handles on garbage collection).
    """
    s = settings or get_settings()
    Path(s.db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    db = kuzu.Database(str(s.db_path))
    try:
        conn = kuzu.Connection(db)
        yield conn
    finally:
        # Drop refs so Kuzu releases the handles deterministically.
        del conn  # type: ignore[possibly-undefined]
        del db


def _clean(value: Any) -> Any:
    """Convert NaN / pandas-NA to ``None`` for JSON serialization."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NA:
        return None
    return value


def _synth_node_id(kind: str, name: str) -> str:
    """Stable, opaque id for a node — used by frontend payloads."""
    return f"{kind}:{name}"


def _synth_edge_id(source: str, rel: str, target: str) -> str:
    """Stable, opaque id for an edge."""
    return f"{source}-{rel}-{target}"


def _query_df(conn: kuzu.Connection, cypher: str, params: dict[str, Any] | None = None) -> pd.DataFrame:
    res = conn.execute(cypher, params or {})
    return res.get_as_df()


def fetch_graph_payload(settings: Settings | None = None) -> dict[str, Any]:
    """Return the full graph as a {nodes, edges} payload for Cytoscape.js."""
    s = settings or get_settings()
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    with kuzu_connection(s) as conn:
        # Collaborators
        df_c = _query_df(
            conn,
            "MATCH (c:Collaborator) RETURN c.name AS name ORDER BY name",
        )
        for name in df_c["name"].tolist():
            name = _clean(name)
            if name is None:
                continue
            nodes.append(
                {
                    "id": _synth_node_id("Collaborator", name),
                    "kind": "Collaborator",
                    "name": name,
                }
            )

        # Sectors
        df_s = _query_df(
            conn,
            "MATCH (s:Sector) RETURN s.name AS name ORDER BY name",
        )
        for name in df_s["name"].tolist():
            name = _clean(name)
            if name is None:
                continue
            nodes.append(
                {
                    "id": _synth_node_id("Sector", name),
                    "kind": "Sector",
                    "name": name,
                }
            )

        # Affiliations
        df_a = _query_df(
            conn,
            """
            MATCH (a:Affiliation)
            RETURN
                a.name      AS name,
                a.address   AS address,
                a.latitude  AS latitude,
                a.longitude AS longitude,
                a.crs       AS crs
            ORDER BY a.name
            """,
        )
        for row in df_a.to_dict(orient="records"):
            name = _clean(row.get("name"))
            if name is None:
                continue
            nodes.append(
                {
                    "id": _synth_node_id("Affiliation", name),
                    "kind": "Affiliation",
                    "name": name,
                    "address": _clean(row.get("address")),
                    "latitude": _clean(row.get("latitude")),
                    "longitude": _clean(row.get("longitude")),
                    "crs": _clean(row.get("crs")),
                }
            )

        # Edges (one query per rel type, with friendly endpoint kinds)
        edge_specs = [
            ("AFFILIATED_WITH", "Collaborator", "Affiliation"),
            ("WORKS_IN", "Collaborator", "Sector"),
            ("PRESENT_AT", "Sector", "Affiliation"),
        ]
        for rel, src_label, tgt_label in edge_specs:
            df_e = _query_df(
                conn,
                f"""
                MATCH (a:{src_label})-[:{rel}]->(b:{tgt_label})
                RETURN a.name AS src, b.name AS tgt
                """,
            )
            for r in df_e.to_dict(orient="records"):
                src_name = _clean(r.get("src"))
                tgt_name = _clean(r.get("tgt"))
                if src_name is None or tgt_name is None:
                    continue
                src_id = _synth_node_id(src_label, src_name)
                tgt_id = _synth_node_id(tgt_label, tgt_name)
                edges.append(
                    {
                        "id": _synth_edge_id(src_id, rel, tgt_id),
                        "source": src_id,
                        "target": tgt_id,
                        "rel": rel,
                    }
                )

    return {"nodes": nodes, "edges": edges}


def fetch_affiliations_geo(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Return affiliations enriched with their collaborators and sectors."""
    s = settings or get_settings()
    out: list[dict[str, Any]] = []

    with kuzu_connection(s) as conn:
        df_aff = _query_df(
            conn,
            """
            MATCH (a:Affiliation)
            RETURN
                a.name      AS name,
                a.address   AS address,
                a.latitude  AS latitude,
                a.longitude AS longitude,
                a.crs       AS crs
            ORDER BY a.name
            """,
        )

        # Collaborators per affiliation
        df_collab = _query_df(
            conn,
            """
            MATCH (c:Collaborator)-[:AFFILIATED_WITH]->(a:Affiliation)
            RETURN a.name AS aff, c.name AS collaborator
            """,
        )
        collab_map: dict[str, list[str]] = {}
        for r in df_collab.to_dict(orient="records"):
            aff = _clean(r.get("aff"))
            c = _clean(r.get("collaborator"))
            if aff is None or c is None:
                continue
            collab_map.setdefault(aff, []).append(c)

        # Sectors per affiliation (via PRESENT_AT)
        df_sec = _query_df(
            conn,
            """
            MATCH (s:Sector)-[:PRESENT_AT]->(a:Affiliation)
            RETURN a.name AS aff, s.name AS sector
            """,
        )
        sec_map: dict[str, list[str]] = {}
        for r in df_sec.to_dict(orient="records"):
            aff = _clean(r.get("aff"))
            sec = _clean(r.get("sector"))
            if aff is None or sec is None:
                continue
            sec_map.setdefault(aff, []).append(sec)

        for row in df_aff.to_dict(orient="records"):
            name = _clean(row.get("name"))
            if name is None:
                continue
            out.append(
                {
                    "name": name,
                    "address": _clean(row.get("address")),
                    "latitude": _clean(row.get("latitude")),
                    "longitude": _clean(row.get("longitude")),
                    "crs": _clean(row.get("crs")),
                    "collaborators": sorted(set(collab_map.get(name, []))),
                    "sectors": sorted(set(sec_map.get(name, []))),
                }
            )
    return out


def fetch_virtual_sector_links(
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Return inferred Affiliation<->Affiliation links via shared Sectors.

    Each row encodes one virtual link (two affiliations linked because at
    least one sector is present at both).
    """
    s = settings or get_settings()
    with kuzu_connection(s) as conn:
        df = _query_df(
            conn,
            """
            MATCH (s:Sector)-[:PRESENT_AT]->(a1:Affiliation),
                  (s)-[:PRESENT_AT]->(a2:Affiliation)
            WHERE a1.name < a2.name
            RETURN
                a1.name      AS source_name,
                a1.latitude  AS source_lat,
                a1.longitude AS source_lon,
                a2.name      AS target_name,
                a2.latitude  AS target_lat,
                a2.longitude AS target_lon,
                s.name       AS sector
            """,
        )

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in df.to_dict(orient="records"):
        src_name = _clean(row.get("source_name"))
        tgt_name = _clean(row.get("target_name"))
        sec = _clean(row.get("sector"))
        if src_name is None or tgt_name is None:
            continue
        key = (src_name, tgt_name)
        if key not in grouped:
            grouped[key] = {
                "source": {
                    "name": src_name,
                    "latitude": _clean(row.get("source_lat")),
                    "longitude": _clean(row.get("source_lon")),
                },
                "target": {
                    "name": tgt_name,
                    "latitude": _clean(row.get("target_lat")),
                    "longitude": _clean(row.get("target_lon")),
                },
                "sectors": [],
            }
        if sec is not None:
            grouped[key]["sectors"].append(sec)

    out: list[dict[str, Any]] = []
    for entry in grouped.values():
        entry["sectors"] = sorted(set(entry["sectors"]))
        out.append(entry)
    return out


def graph_stats(settings: Settings | None = None) -> dict[str, int]:
    """Return high-level node/relationship counts."""
    s = settings or get_settings()
    counts = {"collaborators": 0, "sectors": 0, "affiliations": 0, "relationships": 0}
    with kuzu_connection(s) as conn:
        try:
            counts["collaborators"] = int(
                _query_df(conn, "MATCH (c:Collaborator) RETURN count(c) AS n").iloc[0, 0]
            )
        except Exception:  # noqa: BLE001
            counts["collaborators"] = 0
        try:
            counts["sectors"] = int(
                _query_df(conn, "MATCH (s:Sector) RETURN count(s) AS n").iloc[0, 0]
            )
        except Exception:  # noqa: BLE001
            counts["sectors"] = 0
        try:
            counts["affiliations"] = int(
                _query_df(conn, "MATCH (a:Affiliation) RETURN count(a) AS n").iloc[0, 0]
            )
        except Exception:  # noqa: BLE001
            counts["affiliations"] = 0

        rel_total = 0
        for rel in ("AFFILIATED_WITH", "WORKS_IN", "PRESENT_AT"):
            try:
                rel_total += int(
                    _query_df(
                        conn, f"MATCH ()-[r:{rel}]->() RETURN count(r) AS n"
                    ).iloc[0, 0]
                )
            except Exception:  # noqa: BLE001
                continue
        counts["relationships"] = rel_total
    return counts


def list_unique(column: str, settings: Settings | None = None) -> list[str]:
    """Return distinct values for a node-name column (sector / affiliation)."""
    label = {"sector": "Sector", "affiliation": "Affiliation"}.get(column)
    if label is None:
        raise ValueError(f"Unsupported column: {column}")
    s = settings or get_settings()
    with kuzu_connection(s) as conn:
        df = _query_df(
            conn,
            f"MATCH (n:{label}) RETURN n.name AS name ORDER BY name",
        )
    return [n for n in (str(v) for v in df["name"].tolist()) if n and n != "nan"]


def _bytes_to_dataframe(
    content: bytes,
    sheet: str,
    column_map: dict[str, object] | None = None,
) -> pd.DataFrame:
    """Read uploaded Excel bytes through the shared loader logic."""
    from collabgraph.loader import read_collaborators_bytes

    return read_collaborators_bytes(content, sheet=sheet, column_map=column_map)
