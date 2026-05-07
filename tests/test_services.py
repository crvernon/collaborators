"""Tests for the Kuzu-backed web services helpers."""

from __future__ import annotations

import pandas as pd

from collabgraph.config import Settings
from collabgraph.ingest import Ingestor
from collabgraph.web import services


def _seed(settings: Settings, frame: pd.DataFrame) -> None:
    with Ingestor(settings.db_path) as ing:
        ing.init_schema()
        ing.ingest(frame)


def test_fetch_graph_payload_shape(
    kuzu_settings: Settings, sample_frame: pd.DataFrame
) -> None:
    _seed(kuzu_settings, sample_frame)
    payload = services.fetch_graph_payload(kuzu_settings)
    nodes_by_kind = {"Collaborator": 0, "Sector": 0, "Affiliation": 0}
    for n in payload["nodes"]:
        nodes_by_kind[n["kind"]] += 1
    assert nodes_by_kind == {"Collaborator": 3, "Sector": 2, "Affiliation": 2}

    rels = {e["rel"] for e in payload["edges"]}
    assert rels == {"AFFILIATED_WITH", "WORKS_IN", "PRESENT_AT"}

    assert all(":" in n["id"] for n in payload["nodes"])
    assert all("-" in e["id"] for e in payload["edges"])


def test_graph_stats(
    kuzu_settings: Settings, sample_frame: pd.DataFrame
) -> None:
    _seed(kuzu_settings, sample_frame)
    stats = services.graph_stats(kuzu_settings)
    assert stats["collaborators"] == 3
    assert stats["sectors"] == 2
    assert stats["affiliations"] == 2
    assert stats["relationships"] == 3 + 3 + 2


def test_list_unique(
    kuzu_settings: Settings, sample_frame: pd.DataFrame
) -> None:
    _seed(kuzu_settings, sample_frame)
    sectors = services.list_unique("sector", kuzu_settings)
    affs = services.list_unique("affiliation", kuzu_settings)
    assert set(sectors) == {"Hydropower", "Engineering"}
    assert set(affs) == {"PNNL", "Acme"}


def test_fetch_affiliations_geo_enriched(
    kuzu_settings: Settings, sample_frame: pd.DataFrame
) -> None:
    _seed(kuzu_settings, sample_frame)
    rows = services.fetch_affiliations_geo(kuzu_settings)
    by_name = {r["name"]: r for r in rows}
    assert sorted(by_name) == ["Acme", "PNNL"]
    assert by_name["PNNL"]["collaborators"] == ["Alice", "Bob"]
    assert by_name["PNNL"]["sectors"] == ["Hydropower"]
    assert by_name["Acme"]["collaborators"] == ["Carol"]
    assert by_name["Acme"]["sectors"] == ["Engineering"]


def test_fetch_virtual_sector_links(kuzu_settings: Settings) -> None:
    """Two affiliations sharing a sector produce one virtual link."""
    df = pd.DataFrame(
        [
            {
                "collaborator": "Alice",
                "sector": "Hydropower",
                "affiliation": "PNNL",
                "address": "A",
                "latitude": 1.0,
                "longitude": 2.0,
                "crs": "EPSG:4326",
            },
            {
                "collaborator": "Bob",
                "sector": "Hydropower",
                "affiliation": "Acme",
                "address": "B",
                "latitude": 3.0,
                "longitude": 4.0,
                "crs": "EPSG:4326",
            },
        ]
    )
    _seed(kuzu_settings, df)
    links = services.fetch_virtual_sector_links(kuzu_settings)
    assert len(links) == 1
    link = links[0]
    assert sorted([link["source"]["name"], link["target"]["name"]]) == ["Acme", "PNNL"]
    assert link["sectors"] == ["Hydropower"]
