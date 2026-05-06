"""Excel loader for the collaborator dataset.

The expected sheet has the following columns:

``collaborator``, ``sector``, ``affiliation``, ``address``,
``latitude``, ``longitude``, and (optionally) ``crs``.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REQUIRED_COLUMNS: tuple[str, ...] = (
    "collaborator",
    "sector",
    "affiliation",
)

OPTIONAL_COLUMNS: tuple[str, ...] = ("address", "latitude", "longitude", "crs")

_STRING_COLUMNS: tuple[str, ...] = (
    "collaborator",
    "sector",
    "affiliation",
    "address",
    "crs",
)


def read_collaborators(
    path: str | Path,
    sheet: str | int = "collaborators",
) -> pd.DataFrame:
    """Read and normalize the collaborators Excel sheet.

    Parameters
    ----------
    path
        Path to the ``.xlsx`` file.
    sheet
        Sheet name or index (default ``"collaborators"``).

    Returns
    -------
    pandas.DataFrame
        DataFrame with stripped string columns, numeric ``latitude`` /
        ``longitude`` (when present), and rows missing required values dropped.

    Raises
    ------
    FileNotFoundError
        If ``path`` does not exist.
    ValueError
        If any of :data:`REQUIRED_COLUMNS` is missing from the sheet.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"Excel file not found: {file_path}")

    df = pd.read_excel(file_path, sheet_name=sheet)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"Missing required columns in '{file_path.name}': {missing}"
        )

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
