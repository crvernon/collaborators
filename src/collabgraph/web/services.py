"""Service-layer helpers shared by the FastAPI routes."""

from __future__ import annotations

import math
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import pandas as pd
from neo4j import GraphDatabase

from collabgraph.config import Settings, load_settings


def get_settings() -> Settings:
    """Load Neo4j settings from environment / .env file."""
    return load_settings()


@contextmanager
def neo4j_driver(settings: Settings | None = None) -> Iterator[Any]:
    """Yield a Neo4j driver and close it afterwards."""
    s = settings or get_settings()
    driver = GraphDatabase.driver(s.uri, auth=(s.user, s.password))
    try:
        yield driver
    finally:
        driver.close()


def _clean(value: Any) -> Any:
    """Convert NaN / pandas-NA to ``None`` for JSON serialization."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NA:
        return None
    return value


def fetch_graph_payload(settings: Settings | None = None) -> dict[str, Any]:
    """Return the full graph as a {nodes, edges} payload for Cytoscape.js."""
    s = settings or get_settings()
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_nodes: set[str] = set()

    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            collab_rows = session.run(
                """
                MATCH (n)
                WHERE n:Collaborator OR n:Sector OR n:Affiliation
                RETURN
                    elementId(n) AS id,
                    labels(n)    AS labels,
                    n.name       AS name,
                    n.address    AS address,
                    n.latitude   AS latitude,
                    n.longitude  AS longitude,
                    n.crs        AS crs
                """
            ).data()

            for row in collab_rows:
                kind = next(
                    (
                        lbl
                        for lbl in row["labels"]
                        if lbl in {"Collaborator", "Sector", "Affiliation"}
                    ),
                    "Unknown",
                )
                node_id = row["id"]
                if node_id in seen_nodes:
                    continue
                seen_nodes.add(node_id)
                node = {
                    "id": node_id,
                    "kind": kind,
                    "name": _clean(row["name"]),
                }
                if kind == "Affiliation":
                    node["address"] = _clean(row.get("address"))
                    node["latitude"] = _clean(row.get("latitude"))
                    node["longitude"] = _clean(row.get("longitude"))
                    node["crs"] = _clean(row.get("crs"))
                nodes.append(node)

            edge_rows = session.run(
                """
                MATCH (a)-[r]->(b)
                WHERE (a:Collaborator OR a:Sector OR a:Affiliation)
                  AND (b:Collaborator OR b:Sector OR b:Affiliation)
                RETURN
                    elementId(r) AS id,
                    elementId(a) AS source,
                    elementId(b) AS target,
                    type(r)      AS rel
                """
            ).data()

            for row in edge_rows:
                edges.append(
                    {
                        "id": row["id"],
                        "source": row["source"],
                        "target": row["target"],
                        "rel": row["rel"],
                    }
                )

    return {"nodes": nodes, "edges": edges}


def fetch_affiliations_geo(settings: Settings | None = None) -> list[dict[str, Any]]:
    """Return geocoded affiliations enriched with collaborators and sectors."""
    s = settings or get_settings()
    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            rows = session.run(
                """
                MATCH (a:Affiliation)
                OPTIONAL MATCH (a)<-[:AFFILIATED_WITH]-(c:Collaborator)
                OPTIONAL MATCH (a)<-[:PRESENT_AT]-(s:Sector)
                RETURN
                    a.name      AS name,
                    a.address   AS address,
                    a.latitude  AS latitude,
                    a.longitude AS longitude,
                    a.crs       AS crs,
                    collect(DISTINCT c.name) AS collaborators,
                    collect(DISTINCT s.name) AS sectors
                ORDER BY a.name
                """
            ).data()

    cleaned: list[dict[str, Any]] = []
    for row in rows:
        cleaned.append(
            {
                "name": _clean(row["name"]),
                "address": _clean(row["address"]),
                "latitude": _clean(row["latitude"]),
                "longitude": _clean(row["longitude"]),
                "crs": _clean(row["crs"]),
                "collaborators": [c for c in row["collaborators"] if c],
                "sectors": [se for se in row["sectors"] if se],
            }
        )
    return cleaned


def fetch_virtual_sector_links(
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Return inferred Affiliation<->Affiliation links via shared Sectors.

    Inspired by the Neo4j Bloom / KeyLines geospatial blog post: even though
    affiliations are not directly connected, they share context through the
    sectors that are present at both. Each result row encodes one such
    'virtual link' for the map view.
    """
    s = settings or get_settings()
    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            rows = session.run(
                """
                MATCH (a1:Affiliation)<-[:PRESENT_AT]-(s:Sector)-[:PRESENT_AT]->(a2:Affiliation)
                WHERE a1.name < a2.name
                RETURN
                    a1.name      AS source_name,
                    a1.latitude  AS source_lat,
                    a1.longitude AS source_lon,
                    a2.name      AS target_name,
                    a2.latitude  AS target_lat,
                    a2.longitude AS target_lon,
                    collect(DISTINCT s.name) AS sectors
                """
            ).data()

    return [
        {
            "source": {
                "name": _clean(r["source_name"]),
                "latitude": _clean(r["source_lat"]),
                "longitude": _clean(r["source_lon"]),
            },
            "target": {
                "name": _clean(r["target_name"]),
                "latitude": _clean(r["target_lat"]),
                "longitude": _clean(r["target_lon"]),
            },
            "sectors": [s for s in r["sectors"] if s],
        }
        for r in rows
    ]


def graph_stats(settings: Settings | None = None) -> dict[str, int]:
    """Return high-level node/relationship counts."""
    s = settings or get_settings()
    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            row = session.run(
                """
                MATCH (c:Collaborator) WITH count(c) AS collaborators
                MATCH (se:Sector)      WITH collaborators, count(se) AS sectors
                MATCH (a:Affiliation)  WITH collaborators, sectors, count(a) AS affiliations
                OPTIONAL MATCH ()-[r]->()
                RETURN collaborators, sectors, affiliations, count(r) AS relationships
                """
            ).single()
    if row is None:
        return {
            "collaborators": 0,
            "sectors": 0,
            "affiliations": 0,
            "relationships": 0,
        }
    return dict(row)


def list_unique(column: str, settings: Settings | None = None) -> list[str]:
    """Return distinct values for a node-name column (sector / affiliation)."""
    label = {"sector": "Sector", "affiliation": "Affiliation"}.get(column)
    if label is None:
        raise ValueError(f"Unsupported column: {column}")
    s = settings or get_settings()
    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            rows = session.run(
                f"MATCH (n:{label}) RETURN n.name AS name ORDER BY name"
            ).data()
    return [r["name"] for r in rows if r["name"]]


def run_named_cypher(
    name: str,
    params: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Run a registered Cypher snippet and return rows as dicts."""
    from collabgraph.cypher_examples import get_example

    cypher = get_example(name)
    s = settings or get_settings()
    with neo4j_driver(s) as drv:
        with drv.session(database=s.database) as session:
            rows = session.run(cypher, **(params or {})).data()
    return [{k: _clean(v) for k, v in r.items()} for r in rows]


def _bytes_to_dataframe(content: bytes, sheet: str) -> pd.DataFrame:
    """Read uploaded Excel bytes through the shared loader logic."""
    from io import BytesIO

    from collabgraph.loader import read_collaborators

    tmp_buffer = BytesIO(content)
    raw = pd.read_excel(tmp_buffer, sheet_name=sheet)
    tmp_path = Path(".__upload_tmp__.xlsx")
    raw.to_excel(tmp_path, sheet_name=sheet, index=False)
    try:
        return read_collaborators(tmp_path, sheet=sheet)
    finally:
        tmp_path.unlink(missing_ok=True)
