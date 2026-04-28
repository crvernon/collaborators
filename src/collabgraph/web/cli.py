"""Console entry point for ``collabgraph-web``."""

from __future__ import annotations

import argparse


def main() -> None:
    """Launch the FastAPI web app via uvicorn."""
    parser = argparse.ArgumentParser(
        prog="collabgraph-web",
        description="Run the collabgraph FastAPI web app.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload (development).",
    )
    parser.add_argument(
        "--frontend-dir",
        default=None,
        help=(
            "Path to a built frontend (e.g. web/frontend/dist). "
            "Set COLLABGRAPH_FRONTEND_DIR to override globally."
        ),
    )
    args = parser.parse_args()

    import os

    if args.frontend_dir:
        os.environ["COLLABGRAPH_FRONTEND_DIR"] = args.frontend_dir

    import uvicorn

    uvicorn.run(
        "collabgraph.web.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
