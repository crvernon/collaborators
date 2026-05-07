"""HTTP routes for the collabgraph web UI (Kuzu-backed)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from collabgraph.ingest import Ingestor
from collabgraph.loader import peek_excel_columns, peek_excel_sheet_names
from collabgraph.web.services import (
    _bytes_to_dataframe,
    fetch_affiliations_geo,
    fetch_graph_payload,
    fetch_virtual_sector_links,
    get_settings,
    graph_stats,
    list_unique,
)

router = APIRouter()


class HealthResponse(BaseModel):
    """Connectivity report for the UI."""

    connected: bool
    db_path: str
    error: str | None = None


class SettingsResponse(BaseModel):
    """Read-only view of the active configuration for the UI."""

    db_path: str


class IngestResponse(BaseModel):
    rows: int
    stats: dict[str, int]


class ExcelColumnsResponse(BaseModel):
    columns: list[str]


class ExcelSheetsResponse(BaseModel):
    sheets: list[str]


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    try:
        with Ingestor(settings.db_path) as ing:
            ing.verify_connectivity()
        return HealthResponse(connected=True, db_path=str(settings.db_path_absolute))
    except Exception as exc:  # noqa: BLE001
        return HealthResponse(
            connected=False,
            db_path=str(settings.db_path_absolute),
            error=str(exc),
        )


@router.get("/settings", response_model=SettingsResponse)
def settings_endpoint() -> SettingsResponse:
    s = get_settings()
    return SettingsResponse(db_path=str(s.db_path_absolute))


@router.post("/init-schema")
def init_schema_endpoint() -> dict[str, str]:
    s = get_settings()
    with Ingestor(s.db_path) as ing:
        ing.init_schema()
    return {"status": "ok"}


@router.post("/excel-sheets", response_model=ExcelSheetsResponse)
async def excel_sheets_endpoint(file: UploadFile = File(...)) -> ExcelSheetsResponse:
    """Return worksheet names for an uploaded .xlsx."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    try:
        sheets = peek_excel_sheet_names(content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"Could not read workbook: {exc}",
        ) from exc
    return ExcelSheetsResponse(sheets=sheets)


@router.post("/excel-columns", response_model=ExcelColumnsResponse)
async def excel_columns_endpoint(
    file: UploadFile = File(...),
    sheet: str = Form(default="collaborators"),
) -> ExcelColumnsResponse:
    """Return header row for an uploaded .xlsx (for column mapping UI)."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload.")
    try:
        cols = peek_excel_columns(content, sheet=sheet)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"Could not read sheet '{sheet}': {exc}",
        ) from exc
    return ExcelColumnsResponse(columns=cols)


@router.post("/ingest", response_model=IngestResponse)
async def ingest_endpoint(
    file: UploadFile | None = File(default=None),
    sheet: str = Form(default="collaborators"),
    column_map_json: str | None = Form(default=None),
) -> IngestResponse:
    column_map: dict[str, object] | None = None
    if column_map_json:
        try:
            parsed = json.loads(column_map_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"column_map_json must be JSON: {exc}",
            ) from exc
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=400,
                detail="column_map_json must be a JSON object.",
            )
        column_map = {str(k): v for k, v in parsed.items()}
        if not column_map:
            column_map = None

    if file is None or not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Provide an .xlsx file upload.",
        )
    content = await file.read()
    try:
        df = _bytes_to_dataframe(content, sheet=sheet, column_map=column_map)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400, detail=f"Failed to parse upload: {exc}"
        ) from exc

    s = get_settings()
    with Ingestor(s.db_path) as ing:
        ing.init_schema()
        n = ing.ingest(df)

    return IngestResponse(rows=n, stats=graph_stats(s))


@router.post("/clear")
def clear_endpoint() -> dict[str, str]:
    s = get_settings()
    with Ingestor(s.db_path) as ing:
        ing.clear()
    return {"status": "ok"}


@router.get("/stats")
def stats_endpoint() -> dict[str, int]:
    return graph_stats()


@router.get("/graph")
def graph_endpoint() -> dict[str, Any]:
    return fetch_graph_payload()


@router.get("/affiliations")
def affiliations_endpoint() -> list[dict[str, Any]]:
    return fetch_affiliations_geo()


@router.get("/affiliations/links")
def affiliation_links_endpoint() -> list[dict[str, Any]]:
    return fetch_virtual_sector_links()


@router.get("/values/{column}")
def values_endpoint(column: str) -> list[str]:
    try:
        return list_unique(column)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
