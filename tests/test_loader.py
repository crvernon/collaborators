"""Tests for ``collabgraph.loader``."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from collabgraph.loader import (
    REQUIRED_COLUMNS,
    apply_column_map,
    normalize_collaborators_dataframe,
    peek_excel_sheet_names,
    read_collaborators,
)


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


def test_column_map_renames_before_normalize(tmp_path: Path) -> None:
    raw = pd.DataFrame(
        [
            {
                "Person": "Alice",
                "Industry": "Hydropower",
                "Org": "PNNL",
                "Addr": "Richland",
                "Lat": 46.3,
                "Lon": -119.3,
            }
        ]
    )
    out_path = tmp_path / "mapped.xlsx"
    raw.to_excel(out_path, sheet_name="collaborators", index=False)

    df = read_collaborators(
        out_path,
        column_map={
            "collaborator": "Person",
            "sector": "Industry",
            "affiliation": "Org",
            "address": "Addr",
            "latitude": "Lat",
            "longitude": "Lon",
        },
    )
    assert df.loc[0, "collaborator"] == "Alice"
    assert df.loc[0, "sector"] == "Hydropower"
    assert df.loc[0, "affiliation"] == "PNNL"


def test_apply_column_map_duplicate_source_raises() -> None:
    df = pd.DataFrame([{"A": 1, "B": 2}])
    with pytest.raises(ValueError, match="more than once"):
        apply_column_map(
            df,
            {"collaborator": "A", "sector": "A", "affiliation": "B"},
        )


def test_normalize_requires_canonical_columns() -> None:
    df = pd.DataFrame([{"x": 1}])
    with pytest.raises(ValueError, match="Missing required columns"):
        normalize_collaborators_dataframe(df)


def test_peek_excel_sheet_names(tmp_path: Path) -> None:
    p1 = tmp_path / "a.xlsx"
    pd.DataFrame({"x": [1]}).to_excel(p1, sheet_name="First", index=False)
    with open(p1, "rb") as f:
        names = peek_excel_sheet_names(f.read())
    assert names == ["First"]

    p2 = tmp_path / "b.xlsx"
    with pd.ExcelWriter(p2) as w:
        pd.DataFrame({"a": [1]}).to_excel(w, sheet_name="collaborators", index=False)
        pd.DataFrame({"b": [2]}).to_excel(w, sheet_name="Other", index=False)
    with open(p2, "rb") as f:
        names2 = peek_excel_sheet_names(f.read())
    assert names2 == ["collaborators", "Other"]
