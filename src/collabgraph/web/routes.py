"""HTTP routes for the collabgraph web UI."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from neo4j.exceptions import ServiceUnavailable
from pydantic import BaseModel, Field

from collabgraph.cypher_examples import (
    BLOOM_PERSPECTIVE_HINT,
    get_example,
    list_examples,
)
from collabgraph.ingest import Neo4jIngestor
from collabgraph.loader import read_collaborators
from collabgraph.web.services import (
    _bytes_to_dataframe,
    fetch_affiliations_geo,
    fetch_graph_payload,
    fetch_virtual_sector_links,
    get_settings,
    graph_stats,
    list_unique,
    run_named_cypher,
)

router = APIRouter()

DEFAULT_DATA_PATH = Path("data/collaborators.xlsx")


class HealthResponse(BaseModel):
    """Connectivity report for the UI."""

    connected: bool
    uri: str
    user: str
    database: str
    error: str | None = None


class IngestResponse(BaseModel):
    rows: int
    stats: dict[str, int]


class CypherRunRequest(BaseModel):
    name: str
    params: dict[str, Any] = Field(default_factory=dict)


class CypherRunResponse(BaseModel):
    name: str
    cypher: str
    rows: list[dict[str, Any]]


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    try:
        with Neo4jIngestor(
            settings.uri, settings.user, settings.password, settings.database
        ) as ing:
            ing.verify_connectivity()
        return HealthResponse(
            connected=True,
            uri=settings.uri,
            user=settings.user,
            database=settings.database,
        )
    except (ServiceUnavailable, Exception) as exc:  # noqa: BLE001
        return HealthResponse(
            connected=False,
            uri=settings.uri,
            user=settings.user,
            database=settings.database,
            error=str(exc),
        )


@router.get("/settings")
def settings_endpoint() -> dict[str, str]:
    s = get_settings()
    return {"uri": s.uri, "user": s.user, "database": s.database}


@router.post("/init-schema")
def init_schema_endpoint() -> dict[str, str]:
    s = get_settings()
    with Neo4jIngestor(s.uri, s.user, s.password, s.database) as ing:
        ing.init_schema()
    return {"status": "ok"}


@router.post("/ingest", response_model=IngestResponse)
async def ingest_endpoint(
    file: UploadFile | None = File(default=None),
    sheet: str = Form(default="collaborators"),
    use_default: bool = Form(default=False),
) -> IngestResponse:
    if file is not None and file.filename:
        content = await file.read()
        try:
            df = _bytes_to_dataframe(content, sheet=sheet)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Failed to parse upload: {exc}"
            ) from exc
    elif use_default:
        if not DEFAULT_DATA_PATH.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Default data file not found at {DEFAULT_DATA_PATH}",
            )
        df = read_collaborators(DEFAULT_DATA_PATH, sheet=sheet)
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide a file upload or set use_default=true.",
        )

    s = get_settings()
    with Neo4jIngestor(s.uri, s.user, s.password, s.database) as ing:
        ing.init_schema()
        n = ing.ingest(df)

    return IngestResponse(rows=n, stats=graph_stats(s))


@router.post("/clear")
def clear_endpoint() -> dict[str, str]:
    s = get_settings()
    with Neo4jIngestor(s.uri, s.user, s.password, s.database) as ing:
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


@router.get("/cypher")
def cypher_list_endpoint() -> dict[str, Any]:
    return {
        "names": list_examples(),
        "snippets": {n: get_example(n) for n in list_examples()},
        "bloom_hint": BLOOM_PERSPECTIVE_HINT,
    }


@router.post("/cypher/run", response_model=CypherRunResponse)
def cypher_run_endpoint(req: CypherRunRequest) -> CypherRunResponse:
    try:
        cypher = get_example(req.name)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        rows = run_named_cypher(req.name, req.params)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CypherRunResponse(name=req.name, cypher=cypher, rows=rows)
