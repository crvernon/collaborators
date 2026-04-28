"""Command-line interface for the ``collabgraph`` package."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from collabgraph.config import load_settings
from collabgraph.cypher_examples import (
    BLOOM_PERSPECTIVE_HINT,
    get_example,
    list_examples,
)
from collabgraph.ingest import Neo4jIngestor
from collabgraph.loader import read_collaborators
from collabgraph.viz import build_networkx_graph, draw_graph

app = typer.Typer(
    add_completion=False,
    help="Build and visualize a collaborator network graph in Neo4j.",
)

DEFAULT_DATA_PATH = Path("data/collaborators.xlsx")


@app.command("init-schema")
def init_schema_cmd(
    env_file: Optional[Path] = typer.Option(
        None,
        "--env-file",
        help="Optional path to a .env file with NEO4J_* settings.",
    ),
) -> None:
    """Create Neo4j uniqueness constraints and indexes."""
    settings = load_settings(env_file)
    with Neo4jIngestor(
        settings.uri, settings.user, settings.password, settings.database
    ) as ing:
        ing.verify_connectivity()
        ing.init_schema()
    typer.echo("Schema constraints/indexes ensured.")


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
        help="Optional path to a .env file with NEO4J_* settings.",
    ),
) -> None:
    """Read the Excel file and upsert nodes/relationships into Neo4j."""
    settings = load_settings(env_file)
    df = read_collaborators(path, sheet=sheet)
    with Neo4jIngestor(
        settings.uri, settings.user, settings.password, settings.database
    ) as ing:
        ing.verify_connectivity()
        if init_schema:
            ing.init_schema()
        n = ing.ingest(df)
    typer.echo(f"Ingested {n} row(s) from {path}.")


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


@app.command("cypher")
def cypher_cmd(
    name: Optional[str] = typer.Option(
        None,
        "--name",
        "-n",
        help="Snippet name. Omit to list available examples.",
    ),
    bloom_hint: bool = typer.Option(
        False,
        "--bloom-hint",
        help="Print a Bloom perspective hint for this schema.",
    ),
) -> None:
    """Print a named Cypher example or list available snippets."""
    if bloom_hint:
        typer.echo(BLOOM_PERSPECTIVE_HINT)
        return
    if name is None:
        typer.echo("Available Cypher examples:")
        for key in list_examples():
            typer.echo(f"  - {key}")
        return
    typer.echo(get_example(name))


if __name__ == "__main__":
    app()
