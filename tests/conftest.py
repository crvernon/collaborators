"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pandas as pd
import pytest

from collabgraph.config import Settings
from collabgraph.ingest import Ingestor


@pytest.fixture()
def sample_frame() -> pd.DataFrame:
    """A small in-memory frame mirroring the Excel schema."""
    return pd.DataFrame(
        [
            {
                "collaborator": "Alice",
                "sector": "Hydropower",
                "affiliation": "PNNL",
                "address": "Richland, WA",
                "latitude": 46.3,
                "longitude": -119.3,
                "crs": "EPSG:3857",
            },
            {
                "collaborator": "Bob",
                "sector": "Hydropower",
                "affiliation": "PNNL",
                "address": "Richland, WA",
                "latitude": 46.3,
                "longitude": -119.3,
                "crs": "EPSG:3857",
            },
            {
                "collaborator": "Carol",
                "sector": "Engineering",
                "affiliation": "Acme",
                "address": "Anywhere, USA",
                "latitude": 40.0,
                "longitude": -100.0,
                "crs": "EPSG:3857",
            },
        ]
    )


@pytest.fixture()
def sample_xlsx(tmp_path: Path, sample_frame: pd.DataFrame) -> Path:
    """Persist ``sample_frame`` to an .xlsx file and return its path."""
    out = tmp_path / "collaborators.xlsx"
    sample_frame.to_excel(out, sheet_name="collaborators", index=False)
    return out


@pytest.fixture()
def kuzu_db_path(tmp_path: Path) -> Path:
    """Return a fresh on-disk path for an embedded Kuzu DB used by a test."""
    return tmp_path / "test.kuzu"


@pytest.fixture()
def kuzu_settings(kuzu_db_path: Path) -> Settings:
    """Return a Settings object pointing at the per-test Kuzu DB path."""
    return Settings(db_path=str(kuzu_db_path))


@pytest.fixture()
def ingestor(kuzu_db_path: Path) -> Iterator[Ingestor]:
    """Yield an open ``Ingestor`` against a temp Kuzu DB."""
    with Ingestor(str(kuzu_db_path)) as ing:
        yield ing
