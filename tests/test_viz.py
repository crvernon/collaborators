"""Tests for ``collabgraph.viz``."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # noqa: E402  (headless backend before any pyplot import)

import pandas as pd
import pytest

from collabgraph.viz import (
    DEFAULT_NODE_COLORS,
    REL_AFFILIATED_WITH,
    REL_PRESENT_AT,
    REL_WORKS_IN,
    build_networkx_graph,
    draw_graph,
)


def _node_kinds(g) -> set[str]:
    return {data["kind"] for _, data in g.nodes(data=True)}


def test_build_networkx_graph_creates_expected_nodes_and_edges(
    sample_frame: pd.DataFrame,
) -> None:
    g = build_networkx_graph(sample_frame)

    assert _node_kinds(g) == {"Collaborator", "Sector", "Affiliation"}

    rels = {d["rel"] for _, _, d in g.edges(data=True)}
    assert rels == {REL_AFFILIATED_WITH, REL_WORKS_IN, REL_PRESENT_AT}

    affiliations = [
        data for _, data in g.nodes(data=True) if data["kind"] == "Affiliation"
    ]
    pnnl = next(a for a in affiliations if a["name"] == "PNNL")
    assert pnnl["address"] == "Richland, WA"
    assert pnnl["latitude"] == pytest.approx(46.3)
    assert pnnl["longitude"] == pytest.approx(-119.3)


def test_draw_graph_writes_output_file(
    sample_frame: pd.DataFrame, tmp_path: Path
) -> None:
    g = build_networkx_graph(sample_frame)
    out = tmp_path / "graph.png"
    fig = draw_graph(g, output=out, layout="spring", seed=0)
    assert out.exists()
    assert out.stat().st_size > 0
    fig.clear()


def test_draw_graph_filter_sector_restricts_graph(
    sample_frame: pd.DataFrame, tmp_path: Path
) -> None:
    g = build_networkx_graph(sample_frame)
    out = tmp_path / "filtered.png"
    fig = draw_graph(
        g,
        output=out,
        layout="kamada_kawai",
        filter_sector="Engineering",
    )
    assert out.exists()
    fig.clear()


def test_draw_graph_color_overrides_apply(sample_frame: pd.DataFrame) -> None:
    g = build_networkx_graph(sample_frame)
    custom = {"Collaborator": "#ff0000"}
    fig = draw_graph(g, node_colors=custom, layout="circular", legend=True)
    assert DEFAULT_NODE_COLORS["Collaborator"] == "#4C9AFF"
    fig.clear()


def test_draw_graph_invalid_layout_raises(sample_frame: pd.DataFrame) -> None:
    g = build_networkx_graph(sample_frame)
    with pytest.raises(ValueError, match="Unsupported layout"):
        draw_graph(g, layout="not-a-real-layout")
