"""Command-line interface for the ``collabgraph`` package."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from collabgraph.config import load_settings
from collabgraph.ingest import Ingestor
from collabgraph.loader import read_collaborators
from collabgraph.viz import build_networkx_graph, draw_graph

app = typer.Typer(
    add_completion=False,
    help=(
        "Build and visualize a collaborator network graph "
        "stored in an embedded Kuzu database."
    ),
)

DEFAULT_DATA_PATH = Path("data/collaborators.xlsx")


@app.command("init-schema")
def init_schema_cmd(
    env_file: Optional[Path] = typer.Option(
        None,
        "--env-file",
        help="Optional path to a .env file (e.g. setting COLLABGRAPH_DB_PATH).",
    ),
) -> None:
    """Create node/relationship tables in the embedded Kuzu DB (idempotent)."""
    settings = load_settings(env_file)
    with Ingestor(settings.db_path) as ing:
        ing.verify_connectivity()
        ing.init_schema()
    typer.echo(f"Schema ensured at {settings.db_path_absolute}.")


@app.command("ingest")
def ingest_cmd(
    path: Path = typer.Option(
        DEFAULT_DATA_PATH,
        "--path",
        "-p",
        exists=True,
        readable=True,
        help="Path to the collaborators .xlsx file.",
    ),
    sheet: str = typer.Option(
        "collaborators",
        "--sheet",
        help="Sheet name within the workbook.",
    ),
    init_schema: bool = typer.Option(
        True,
        "--init-schema/--no-init-schema",
        help="Run init-schema before writing rows.",
    ),
    env_file: Optional[Path] = typer.Option(
        None,
        "--env-file",
        help="Optional path to a .env file (e.g. setting COLLABGRAPH_DB_PATH).",
    ),
) -> None:
    """Read the Excel file and upsert nodes/relationships into Kuzu."""
    settings = load_settings(env_file)
    df = read_collaborators(path, sheet=sheet)
    with Ingestor(settings.db_path) as ing:
        ing.verify_connectivity()
        if init_schema:
            ing.init_schema()
        n = ing.ingest(df)
    typer.echo(f"Ingested {n} row(s) from {path} into {settings.db_path_absolute}.")


@app.command("viz")
def viz_cmd(
    path: Path = typer.Option(
        DEFAULT_DATA_PATH,
        "--path",
        "-p",
        exists=True,
        readable=True,
        help="Path to the collaborators .xlsx file.",
    ),
    sheet: str = typer.Option(
        "collaborators",
        "--sheet",
        help="Sheet name within the workbook.",
    ),
    output: Path = typer.Option(
        Path("graph.png"),
        "--output",
        "-o",
        help="Output image path (.png, .pdf, .svg).",
    ),
    layout: str = typer.Option(
        "spring",
        "--layout",
        help="Graph layout: spring, kamada_kawai, circular, shell, spectral.",
    ),
    figsize_w: float = typer.Option(12.0, "--figsize-w"),
    figsize_h: float = typer.Option(9.0, "--figsize-h"),
    dpi: int = typer.Option(200, "--dpi"),
    edge_labels: bool = typer.Option(
        False,
        "--edge-labels/--no-edge-labels",
        help="Show relationship-type labels on edges.",
    ),
    title: Optional[str] = typer.Option(
        "Collaborator network",
        "--title",
        help="Figure title (use empty string to omit).",
    ),
    filter_sector: Optional[str] = typer.Option(
        None,
        "--filter-sector",
        help="Restrict graph to collaborators in this sector.",
    ),
    filter_affiliation: Optional[str] = typer.Option(
        None,
        "--filter-affiliation",
        help="Restrict graph to collaborators at this affiliation.",
    ),
) -> None:
    """Render a static network image from the Excel file."""
    df = read_collaborators(path, sheet=sheet)
    g = build_networkx_graph(df)
    draw_graph(
        g,
        layout=layout,
        figsize=(figsize_w, figsize_h),
        dpi=dpi,
        edge_labels=edge_labels,
        title=title or None,
        output=output,
        filter_sector=filter_sector,
        filter_affiliation=filter_affiliation,
    )
    typer.echo(f"Wrote {output}")


if __name__ == "__main__":
    app()
