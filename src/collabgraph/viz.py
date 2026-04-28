"""Static visualization of the collaborator graph using NetworkX + matplotlib.

The visualization mirrors the Neo4j schema: nodes carry a ``kind`` attribute
(one of ``Collaborator``, ``Sector``, ``Affiliation``) which drives styling.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import networkx as nx
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

NodeKind = str

DEFAULT_NODE_COLORS: dict[NodeKind, str] = {
    "Collaborator": "#4C9AFF",
    "Affiliation": "#36B37E",
    "Sector": "#FF8B00",
}

DEFAULT_NODE_SIZES: dict[NodeKind, int] = {
    "Collaborator": 700,
    "Affiliation": 1500,
    "Sector": 1100,
}

_SUPPORTED_LAYOUTS: dict[str, Any] = {
    "spring": nx.spring_layout,
    "kamada_kawai": nx.kamada_kawai_layout,
    "circular": nx.circular_layout,
    "shell": nx.shell_layout,
    "spectral": nx.spectral_layout,
}

REL_AFFILIATED_WITH = "AFFILIATED_WITH"
REL_WORKS_IN = "WORKS_IN"
REL_PRESENT_AT = "PRESENT_AT"


def _node_id(kind: NodeKind, name: str) -> str:
    """Produce a globally unique node id keyed by (kind, name)."""
    return f"{kind}::{name}"


def build_networkx_graph(df: pd.DataFrame) -> nx.MultiDiGraph:
    """Build a directed multigraph that mirrors the Neo4j schema.

    Parameters
    ----------
    df
        Tidy DataFrame produced by
        :func:`collabgraph.loader.read_collaborators`.

    Returns
    -------
    networkx.MultiDiGraph
        Graph with three node kinds and three relationship types.
    """
    g: nx.MultiDiGraph = nx.MultiDiGraph()

    for record in df.to_dict(orient="records"):
        collaborator = str(record["collaborator"])
        sector = str(record["sector"])
        affiliation = str(record["affiliation"])

        c_id = _node_id("Collaborator", collaborator)
        s_id = _node_id("Sector", sector)
        a_id = _node_id("Affiliation", affiliation)

        g.add_node(c_id, kind="Collaborator", name=collaborator)
        g.add_node(s_id, kind="Sector", name=sector)
        g.add_node(
            a_id,
            kind="Affiliation",
            name=affiliation,
            address=record.get("address"),
            latitude=record.get("latitude"),
            longitude=record.get("longitude"),
            crs=record.get("crs"),
        )

        g.add_edge(c_id, a_id, key=REL_AFFILIATED_WITH, rel=REL_AFFILIATED_WITH)
        g.add_edge(c_id, s_id, key=REL_WORKS_IN, rel=REL_WORKS_IN)
        g.add_edge(s_id, a_id, key=REL_PRESENT_AT, rel=REL_PRESENT_AT)

    return g


def _filter_graph(
    g: nx.MultiDiGraph,
    *,
    filter_sector: str | Iterable[str] | None,
    filter_affiliation: str | Iterable[str] | None,
) -> nx.MultiDiGraph:
    """Restrict a graph to collaborators in given sector(s)/affiliation(s)."""
    if filter_sector is None and filter_affiliation is None:
        return g

    def _as_set(val: str | Iterable[str] | None) -> set[str] | None:
        if val is None:
            return None
        if isinstance(val, str):
            return {val}
        return set(val)

    sectors = _as_set(filter_sector)
    affiliations = _as_set(filter_affiliation)

    keep: set[str] = set()
    for node, data in g.nodes(data=True):
        if data.get("kind") != "Collaborator":
            continue
        c_sectors = {
            g.nodes[v]["name"]
            for _, v, d in g.out_edges(node, data=True)
            if d.get("rel") == REL_WORKS_IN
        }
        c_affs = {
            g.nodes[v]["name"]
            for _, v, d in g.out_edges(node, data=True)
            if d.get("rel") == REL_AFFILIATED_WITH
        }
        sector_ok = sectors is None or bool(c_sectors & sectors)
        aff_ok = affiliations is None or bool(c_affs & affiliations)
        if sector_ok and aff_ok:
            keep.add(node)
            for _, v in g.out_edges(node):
                keep.add(v)

    return g.subgraph(keep).copy()


def _layout_positions(
    g: nx.MultiDiGraph,
    layout: str,
    seed: int | None,
) -> dict[str, tuple[float, float]]:
    if layout not in _SUPPORTED_LAYOUTS:
        raise ValueError(
            f"Unsupported layout '{layout}'. "
            f"Choose from: {sorted(_SUPPORTED_LAYOUTS)}"
        )
    fn = _SUPPORTED_LAYOUTS[layout]
    if layout == "spring":
        return fn(g, seed=seed)
    return fn(g)


def draw_graph(
    g: nx.MultiDiGraph,
    *,
    layout: str = "spring",
    seed: int | None = 42,
    node_colors: Mapping[str, str] | None = None,
    node_sizes: Mapping[str, int] | None = None,
    edge_color: str = "#888888",
    edge_width: float = 1.2,
    with_labels: bool = True,
    label_font_size: int = 9,
    edge_labels: bool = False,
    edge_label_font_size: int = 7,
    figsize: tuple[float, float] = (12, 9),
    title: str | None = "Collaborator network",
    legend: bool = True,
    output: str | Path | None = None,
    dpi: int = 200,
    filter_sector: str | Iterable[str] | None = None,
    filter_affiliation: str | Iterable[str] | None = None,
) -> Figure:
    """Render the graph to a matplotlib :class:`~matplotlib.figure.Figure`.

    Parameters
    ----------
    g
        Graph produced by :func:`build_networkx_graph`.
    layout
        One of ``spring``, ``kamada_kawai``, ``circular``, ``shell``, ``spectral``.
    seed
        Random seed for layouts that accept one (``spring``).
    node_colors
        Optional override for the per-kind color palette. Keys must be node
        kinds (``Collaborator``, ``Affiliation``, ``Sector``).
    node_sizes
        Optional override for per-kind node sizes.
    edge_color, edge_width
        Styling for edges.
    with_labels, label_font_size
        Toggle and size for node labels.
    edge_labels, edge_label_font_size
        Toggle and size for relationship-type edge labels.
    figsize, dpi
        Standard matplotlib figure controls.
    title, legend
        Optional title and legend toggle.
    output
        Optional path; when provided, the figure is saved with
        ``bbox_inches='tight'``.
    filter_sector, filter_affiliation
        Restrict rendering to collaborators in given sector(s) /
        affiliation(s) plus their adjacent nodes.

    Returns
    -------
    matplotlib.figure.Figure
        The figure (also saved if ``output`` was provided).
    """
    colors = {**DEFAULT_NODE_COLORS, **(dict(node_colors) if node_colors else {})}
    sizes = {**DEFAULT_NODE_SIZES, **(dict(node_sizes) if node_sizes else {})}

    sub = _filter_graph(
        g,
        filter_sector=filter_sector,
        filter_affiliation=filter_affiliation,
    )
    if sub.number_of_nodes() == 0:
        raise ValueError("Filtered graph is empty; nothing to draw.")

    pos = _layout_positions(sub, layout=layout, seed=seed)

    fig, ax = plt.subplots(figsize=figsize)
    ax.set_axis_off()

    for kind, color in colors.items():
        nodelist = [n for n, d in sub.nodes(data=True) if d.get("kind") == kind]
        if not nodelist:
            continue
        nx.draw_networkx_nodes(
            sub,
            pos,
            nodelist=nodelist,
            node_color=color,
            node_size=sizes.get(kind, 800),
            edgecolors="#222222",
            linewidths=0.6,
            ax=ax,
        )

    nx.draw_networkx_edges(
        sub,
        pos,
        edge_color=edge_color,
        width=edge_width,
        arrows=True,
        arrowsize=12,
        connectionstyle="arc3,rad=0.08",
        ax=ax,
    )

    if with_labels:
        labels = {n: d.get("name", n) for n, d in sub.nodes(data=True)}
        nx.draw_networkx_labels(
            sub,
            pos,
            labels=labels,
            font_size=label_font_size,
            ax=ax,
        )

    if edge_labels:
        e_labels = {
            (u, v): d.get("rel", "")
            for u, v, d in sub.edges(data=True)
        }
        nx.draw_networkx_edge_labels(
            sub,
            pos,
            edge_labels=e_labels,
            font_size=edge_label_font_size,
            ax=ax,
        )

    if title:
        ax.set_title(title)

    if legend:
        handles = [
            Line2D(
                [0],
                [0],
                marker="o",
                linestyle="",
                color=color,
                markeredgecolor="#222",
                markersize=10,
                label=kind,
            )
            for kind, color in colors.items()
        ]
        ax.legend(handles=handles, loc="best", frameon=True)

    fig.tight_layout()

    if output is not None:
        out_path = Path(output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=dpi, bbox_inches="tight")

    return fig
