"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest


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
