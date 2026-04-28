"""FastAPI application factory for the collaborator graph web UI."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from collabgraph.web.routes import router

DEFAULT_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "web" / "frontend" / "dist"


def _resolve_frontend_dir(explicit: str | None) -> Path | None:
    """Resolve the directory containing the built frontend, if any."""
    if explicit:
        candidate = Path(explicit)
        return candidate if candidate.exists() else None

    env = os.getenv("COLLABGRAPH_FRONTEND_DIR")
    if env:
        candidate = Path(env)
        return candidate if candidate.exists() else None

    return DEFAULT_FRONTEND_DIST if DEFAULT_FRONTEND_DIST.exists() else None


def create_app(frontend_dir: str | None = None) -> FastAPI:
    """Build the FastAPI app, mounting the built frontend when available."""
    app = FastAPI(
        title="collabgraph",
        version="0.1.0",
        description="Web UI for the collaborator network graph (Neo4j).",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api")

    dist = _resolve_frontend_dir(frontend_dir)
    if dist is not None:
        assets_dir = dist / "assets"
        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="assets",
            )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            target = dist / full_path
            if full_path and target.is_file():
                return FileResponse(target)
            return FileResponse(dist / "index.html")

    else:

        @app.get("/", include_in_schema=False)
        async def root() -> dict[str, str]:
            return {
                "message": (
                    "Frontend not built. Run `npm run build` in web/frontend "
                    "or start the Vite dev server (`npm run dev`)."
                ),
                "docs": "/docs",
            }

    return app


app = create_app()
