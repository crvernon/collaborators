"""Excel loader for the collaborator dataset.

The expected sheet has the following columns (after mapping):

``collaborator``, ``sector``, ``affiliation``, ``address``,
``latitude``, ``longitude``, and (optionally) ``crs``.

Use :func:`apply_column_map` when spreadsheet headers use different names.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd

REQUIRED_COLUMNS: tuple[str, ...] = (
    "collaborator",
    "sector",
    "affiliation",
)

OPTIONAL_COLUMNS: tuple[str, ...] = ("address", "latitude", "longitude", "crs")

CANONICAL_COLUMNS: tuple[str, ...] = REQUIRED_COLUMNS + OPTIONAL_COLUMNS

_STRING_COLUMNS: tuple[str, ...] = (
    "collaborator",
    "sector",
    "affiliation",
    "address",
    "crs",
)


def apply_column_map(df: pd.DataFrame, column_map: dict[str, Any]) -> pd.DataFrame:
    """Rename spreadsheet columns to canonical names.

    ``column_map`` maps canonical field name -> source column header string.
    Omit a key or use empty string to skip mapping that field (allowed only
    for optional columns).

    Raises
    ------
    ValueError
        If a mapped source column is missing, duplicated in the map, or if a
        required canonical field is not mapped to any existing column.
    """
    renames: dict[str, str] = {}
    used_sources: set[str] = set()

    for canonical in CANONICAL_COLUMNS:
        raw = column_map.get(canonical, "")
        source = str(raw).strip() if raw is not None else ""
        if not source:
            continue
        if source not in df.columns:
            raise ValueError(
                f"Column '{source}' not found in spreadsheet (expected for '{canonical}')."
            )
        if source in used_sources:
            raise ValueError(f"Spreadsheet column '{source}' is mapped more than once.")
        used_sources.add(source)
        renames[source] = canonical

    return df.rename(columns=renames)


def normalize_collaborators_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Validate canonical columns, coerce types, drop incomplete rows."""
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            "Missing required columns after mapping: "
            f"{missing}. Map collaborator, sector, and affiliation."
        )

    df = df.copy()
    for col in _STRING_COLUMNS:
        if col in df.columns:
            df[col] = df[col].astype("string").str.strip()

    for col in OPTIONAL_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA

    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")

    df = df.dropna(subset=list(REQUIRED_COLUMNS)).reset_index(drop=True)

    return df


def read_excel_raw(path: str | Path, sheet: str | int = "collaborators") -> pd.DataFrame:
    """Read Excel without normalization (headers as in file)."""
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"Excel file not found: {file_path}")
    return pd.read_excel(file_path, sheet_name=sheet)


def read_excel_bytes_raw(content: bytes, sheet: str | int = "collaborators") -> pd.DataFrame:
    """Read Excel from bytes without normalization."""
    return pd.read_excel(BytesIO(content), sheet_name=sheet)


def peek_excel_columns(content: bytes, sheet: str | int = "collaborators") -> list[str]:
    """Return header names from the first row of the given sheet."""
    df = pd.read_excel(BytesIO(content), sheet_name=sheet, nrows=0)
    return [str(c) for c in df.columns]


def peek_excel_sheet_names(content: bytes) -> list[str]:
    """Return all worksheet names in the workbook (order preserved)."""
    xl = pd.ExcelFile(BytesIO(content))
    return [str(name) for name in xl.sheet_names]


def read_collaborators(
    path: str | Path,
    sheet: str | int = "collaborators",
    column_map: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """Read and normalize the collaborators Excel sheet.

    Parameters
    ----------
    path
        Path to the ``.xlsx`` file.
    sheet
        Sheet name or index (default ``"collaborators"``).
    column_map
        Optional mapping from canonical name to source column header.
    """
    df = read_excel_raw(path, sheet=sheet)
    if column_map:
        df = apply_column_map(df, column_map)
    return normalize_collaborators_dataframe(df)


def read_collaborators_bytes(
    content: bytes,
    sheet: str | int = "collaborators",
    column_map: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """Read collaborators from in-memory ``.xlsx`` bytes."""
    df = read_excel_bytes_raw(content, sheet=sheet)
    if column_map:
        df = apply_column_map(df, column_map)
    return normalize_collaborators_dataframe(df)
