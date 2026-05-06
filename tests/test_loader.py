"""Tests for ``collabgraph.loader``."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from collabgraph.loader import REQUIRED_COLUMNS, read_collaborators


def test_read_collaborators_returns_required_columns(sample_xlsx: Path) -> None:
    df = read_collaborators(sample_xlsx)
    for col in REQUIRED_COLUMNS:
        assert col in df.columns
    assert len(df) == 3


def test_read_collaborators_strips_whitespace(tmp_path: Path) -> None:
    raw = pd.DataFrame(
        [
            {
                "collaborator": "  Alice  ",
                "sector": " Hydropower",
                "affiliation": "PNNL ",
                "address": " Richland ",
                "latitude": 46.3,
                "longitude": -119.3,
                "crs": "EPSG:3857",
            }
        ]
    )
    out = tmp_path / "c.xlsx"
    raw.to_excel(out, sheet_name="collaborators", index=False)

    df = read_collaborators(out)
    assert df.loc[0, "collaborator"] == "Alice"
    assert df.loc[0, "sector"] == "Hydropower"
    assert df.loc[0, "affiliation"] == "PNNL"
    assert df.loc[0, "address"] == "Richland"


def test_read_collaborators_missing_required_column_raises(tmp_path: Path) -> None:
    raw = pd.DataFrame(
        [
            {
                "collaborator": "Alice",
                "sector": "Hydropower",
                "address": "Richland",
                "latitude": 46.3,
                "longitude": -119.3,
            }
        ]
    )
    out = tmp_path / "missing.xlsx"
    raw.to_excel(out, sheet_name="collaborators", index=False)

    with pytest.raises(ValueError, match="Missing required columns"):
        read_collaborators(out)


def test_read_collaborators_missing_optional_columns_allowed(tmp_path: Path) -> None:
    raw = pd.DataFrame(
        [
            {
                "collaborator": "Alice",
                "sector": "Hydropower",
                "affiliation": "PNNL",
            }
        ]
    )
    out = tmp_path / "optional_missing.xlsx"
    raw.to_excel(out, sheet_name="collaborators", index=False)

    df = read_collaborators(out)
    assert len(df) == 1
    assert "address" in df.columns
    assert "latitude" in df.columns
    assert "longitude" in df.columns
    assert pd.isna(df.loc[0, "address"])
    assert pd.isna(df.loc[0, "latitude"])
    assert pd.isna(df.loc[0, "longitude"])


def test_read_collaborators_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        read_collaborators(tmp_path / "does_not_exist.xlsx")
