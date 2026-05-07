"""Tests for the Kuzu-backed Ingestor."""

from __future__ import annotations

import pandas as pd

from collabgraph.ingest import Ingestor


def test_init_schema_is_idempotent(ingestor: Ingestor) -> None:
    """Calling init_schema twice must not raise (tables already exist)."""
    ingestor.init_schema()
    ingestor.init_schema()

    df = ingestor.conn.execute("CALL show_tables() RETURN *").get_as_df()
    names = set(df["name"].tolist())
    assert {
        "Collaborator",
        "Sector",
        "Affiliation",
        "AFFILIATED_WITH",
        "WORKS_IN",
        "PRESENT_AT",
    }.issubset(names)


def test_ingest_creates_expected_counts(
    ingestor: Ingestor, sample_frame: pd.DataFrame
) -> None:
    """Ingestion creates the expected number of nodes and rels."""
    ingestor.init_schema()
    written = ingestor.ingest(sample_frame)
    assert written == len(sample_frame)

    counts = {
        "collab": ingestor.conn.execute(
            "MATCH (c:Collaborator) RETURN count(c) AS n"
        ).get_as_df().iloc[0, 0],
        "sector": ingestor.conn.execute(
            "MATCH (s:Sector) RETURN count(s) AS n"
        ).get_as_df().iloc[0, 0],
        "aff": ingestor.conn.execute(
            "MATCH (a:Affiliation) RETURN count(a) AS n"
        ).get_as_df().iloc[0, 0],
    }
    assert counts == {"collab": 3, "sector": 2, "aff": 2}


def test_ingest_is_idempotent(
    ingestor: Ingestor, sample_frame: pd.DataFrame
) -> None:
    """Re-ingesting the same frame must not duplicate nodes or edges."""
    ingestor.init_schema()
    ingestor.ingest(sample_frame)
    ingestor.ingest(sample_frame)

    rel_total = 0
    for rel in ("AFFILIATED_WITH", "WORKS_IN", "PRESENT_AT"):
        rel_total += int(
            ingestor.conn.execute(
                f"MATCH ()-[r:{rel}]->() RETURN count(r) AS n"
            ).get_as_df().iloc[0, 0]
        )
    assert rel_total == 3 + 3 + 2


def test_ingest_handles_optional_nulls(
    ingestor: Ingestor, sample_frame: pd.DataFrame
) -> None:
    """Optional columns with NaN/NA must round-trip as null without leaking
    other rows' values into the affiliation properties."""
    df = sample_frame.copy()
    df.loc[df["affiliation"] == "Acme", ["address", "latitude", "longitude"]] = pd.NA

    ingestor.init_schema()
    ingestor.ingest(df)

    row = (
        ingestor.conn.execute(
            "MATCH (a:Affiliation {name: 'Acme'}) "
            "RETURN a.address AS addr, a.latitude AS lat, a.longitude AS lon"
        )
        .get_as_df()
        .iloc[0]
    )
    assert pd.isna(row["addr"])
    assert pd.isna(row["lat"])
    assert pd.isna(row["lon"])

    pnnl = (
        ingestor.conn.execute(
            "MATCH (a:Affiliation {name: 'PNNL'}) RETURN a.address AS addr"
        )
        .get_as_df()
        .iloc[0]
    )
    assert pnnl["addr"] == "Richland, WA"


def test_clear_removes_everything(
    ingestor: Ingestor, sample_frame: pd.DataFrame
) -> None:
    ingestor.init_schema()
    ingestor.ingest(sample_frame)
    ingestor.clear()
    n = int(
        ingestor.conn.execute(
            "MATCH (c:Collaborator) RETURN count(c) AS n"
        ).get_as_df().iloc[0, 0]
    )
    assert n == 0
