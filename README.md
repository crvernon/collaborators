# collaborators

Build a collaborator network graph in [Neo4j](https://neo4j.com/) from an
Excel input file. Ships with:

- a Python package (`collabgraph`) with a Typer CLI for ingest and
  matplotlib visualization,
- a FastAPI + React/Vite web app with interactive graph and geospatial map
  views,
- a Jupyter tutorial notebook,
- bundled Cypher snippets for Neo4j Browser / Bloom.

The graph schema (idempotent `MERGE`-based writes) is:

```
(:Collaborator {name})-[:AFFILIATED_WITH]->(:Affiliation {name, address, latitude, longitude, crs})
(:Collaborator {name})-[:WORKS_IN]->(:Sector {name})
(:Sector {name})-[:PRESENT_AT]->(:Affiliation {name})
```

`address`, `latitude`, `longitude`, and `crs` are stored as attributes on the
`Affiliation` node only.

## Project layout

```
collaborators/
├── pyproject.toml
├── uv.lock
├── README.md
├── .env.example          # template -> copy to .env (gitignored)
├── data/collaborators.xlsx
├── notebooks/tutorial.ipynb
├── src/collabgraph/
│   ├── __init__.py
│   ├── config.py         # .env loader (NEO4J_URI, NEO4J_USER, ...)
│   ├── schema.py         # Cypher constraints / indexes
│   ├── loader.py         # read_collaborators(path) -> pd.DataFrame
│   ├── ingest.py         # Neo4jIngestor (init_schema, ingest, clear)
│   ├── viz.py            # build_networkx_graph + draw_graph (matplotlib)
│   ├── cypher_examples.py
│   ├── cli.py            # `collabgraph` Typer CLI
│   └── web/              # FastAPI backend (app, routes, services, cli)
├── tests/                # pytest suite
└── web/frontend/         # Vite + React + TypeScript app
```

## Requirements

- Python **3.11+**
- [`uv`](https://docs.astral.sh/uv/) (install: `pipx install uv` or
  `pip install uv`)
- A reachable Neo4j 5+ instance
- Node.js 18+ and npm (only required to build / run the web app)

## Configure (`.env`)

Copy the template and edit the values:

```bash
cp .env.example .env
```

The required variables are:

| Variable          | Required | Default | Description                                              |
| ----------------- | -------- | ------- | -------------------------------------------------------- |
| `NEO4J_URI`       | yes      | —       | Bolt URI, e.g. `bolt://localhost:7687`, `neo4j+s://...`  |
| `NEO4J_USER`      | yes      | —       | Database username                                        |
| `NEO4J_PASSWORD`  | yes      | —       | Database password (don't commit)                         |
| `NEO4J_DATABASE`  | no       | `neo4j` | Target database (Neo4j 4+ multi-db)                      |

`.env` is gitignored; `.env.example` is committed so contributors know what
to set.

## Install

```bash
uv sync                  # core package + tests + notebook
uv sync --extra web      # also installs FastAPI + uvicorn for the web app
```

## Use the CLI

```bash
uv run collabgraph init-schema
uv run collabgraph ingest --path data/collaborators.xlsx
uv run collabgraph viz --path data/collaborators.xlsx --output graph.png
uv run collabgraph viz --layout kamada_kawai --filter-sector Hydropower --output hydro.png
uv run collabgraph cypher                                  # list snippets
uv run collabgraph cypher --name collaborators_by_sector   # print one
uv run collabgraph cypher --bloom-hint                     # Bloom perspective hint
```

`collabgraph --help` lists every command and option.

## Use the Python API

```python
from collabgraph import (
    Neo4jIngestor,
    build_networkx_graph,
    draw_graph,
    load_settings,
    read_collaborators,
)

df = read_collaborators("data/collaborators.xlsx")

settings = load_settings()
with Neo4jIngestor(
    settings.uri, settings.user, settings.password, settings.database
) as ing:
    ing.init_schema()
    ing.ingest(df)

g = build_networkx_graph(df)
draw_graph(
    g,
    layout="kamada_kawai",
    figsize=(14, 10),
    edge_labels=True,
    node_colors={"Collaborator": "#4C9AFF", "Sector": "#FF8B00", "Affiliation": "#36B37E"},
    node_sizes={"Collaborator": 700, "Sector": 1100, "Affiliation": 1500},
    title="Collaborator network",
    output="graph.png",
)
```

## Visualize in Neo4j Browser / Bloom

After `ingest`, paste this into Neo4j Browser to see everything:

```cypher
MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m
```

Run `collabgraph cypher --bloom-hint` for a suggested Bloom perspective
(node colors, captions, and useful search phrases).

## Web app

A modern React + FastAPI web UI lives under [`web/frontend/`](web/frontend) and
[`src/collabgraph/web/`](src/collabgraph/web), with four views:

- **Setup** — live connection status, `init-schema`, ingest from upload or the
  default `data/collaborators.xlsx`, database stats panel, and a "danger zone"
  clear action.
- **Graph** — Cytoscape.js graph with selectable layout
  (`cose-bilkent`, `concentric`, `circle`, `grid`, `breadthfirst`),
  per-kind color palette, sector / affiliation filters, label toggles, and
  PNG export.
- **Map** — Leaflet basemap (OpenStreetMap, Carto Light, Carto Dark) with
  `Affiliation` markers and pop-ups listing collaborators and sectors. A
  toggle overlays "virtual links" between affiliations that share a sector,
  inspired by the
  [Neo4j geospatial graph visualization blog post](https://neo4j.com/blog/graph-visualization/mapping-a-connected-world-geospatial-graph-visualization/)
  (the same idea KeyLines uses for fraud-investigation views).
- **Cypher** — pick any of the bundled named snippets, fill in `$params`,
  run it, and inspect the result table. Includes the Bloom perspective hint.

### Install the web extras

```bash
uv sync --extra web
cd web/frontend && npm install
```

### Development (hot reload)

In two terminals:

```bash
# Terminal 1 — FastAPI (auto-reloads on Python changes)
uv run collabgraph-web --reload --port 8000

# Terminal 2 — Vite dev server (proxies /api -> :8000)
cd web/frontend && npm run dev
```

Then open <http://localhost:5173>.

### Production-style run (single port)

```bash
cd web/frontend && npm run build && cd ../..
uv run collabgraph-web --port 8000
```

The FastAPI server then serves the built frontend at
<http://localhost:8000> and the JSON API under `/api`. Override the
location with `--frontend-dir` or the `COLLABGRAPH_FRONTEND_DIR` env var.

### API endpoints

- `GET  /api/health` — connection status and `.env` settings.
- `GET  /api/settings` — `{uri, user, database}` (no password).
- `GET  /api/stats` — `{collaborators, sectors, affiliations, relationships}`.
- `POST /api/init-schema` — create constraints / indexes.
- `POST /api/ingest` — multipart upload (`file=<xlsx>`, `sheet=<name>`) or
  `use_default=true` to ingest the bundled `data/collaborators.xlsx`.
- `POST /api/clear` — delete all nodes/edges (use with care).
- `GET  /api/graph` — full graph payload `{nodes, edges}` for Cytoscape.
- `GET  /api/affiliations` — geocoded affiliations + collaborators + sectors.
- `GET  /api/affiliations/links` — virtual Affiliation⇄Affiliation links via
  shared sectors.
- `GET  /api/values/{sector|affiliation}` — distinct names for filter
  dropdowns.
- `GET  /api/cypher` — list named Cypher snippets and the Bloom hint.
- `POST /api/cypher/run` — body `{name, params}`; runs the named snippet and
  returns rows.

Interactive OpenAPI docs are available at
<http://localhost:8000/docs> when the server is running.

## Tutorial notebook

A walk-through of the full workflow lives in
[`notebooks/tutorial.ipynb`](notebooks/tutorial.ipynb). To run it, register
the project venv as a Jupyter kernel once, then open the notebook:

```bash
uv run python -m ipykernel install --user --name collabgraph --display-name "Python (collabgraph)"
uv run jupyter lab notebooks/tutorial.ipynb
```

To execute it headlessly (e.g. from CI):

```bash
uv run jupyter nbconvert --to notebook --execute --inplace notebooks/tutorial.ipynb
```

## Tests

```bash
uv run pytest
```

## License

MIT — see [LICENSE](LICENSE).
