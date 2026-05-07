# collaborators

Build a collaborator network graph from an Excel input file. The graph is
stored in an **embedded [Kùzu](https://kuzudb.com/) database**, so the entire
stack (CLI, web app, notebook, DB) runs as a single Python process — no
external graph database server required. Ships with:

- a Python package (`collabgraph`) with a Typer CLI for ingest and
  matplotlib visualization,
- a FastAPI + React/Vite web app with interactive graph and geospatial map
  views (Cytoscape.js + Leaflet),
- a Jupyter tutorial notebook.

The graph schema (idempotent `MERGE`-based writes) is:

```
(:Collaborator {name})-[:AFFILIATED_WITH]->(:Affiliation {name, address, latitude, longitude, crs})
(:Collaborator {name})-[:WORKS_IN]->(:Sector {name})
(:Sector {name})-[:PRESENT_AT]->(:Affiliation {name})
```

`address`, `latitude`, `longitude`, and `crs` are stored as attributes on the
`Affiliation` node only and are all optional in the source spreadsheet.

## Project layout

```
collaborators/
├── pyproject.toml
├── uv.lock
├── README.md
├── .env.example          # template -> copy to .env (gitignored)
├── data/collaborators.xlsx
├── data/collabgraph.kuzu/        # created on first init / ingest
├── notebooks/tutorial.ipynb
├── src/collabgraph/
│   ├── __init__.py
│   ├── config.py         # .env loader (COLLABGRAPH_DB_PATH)
│   ├── schema.py         # Kuzu DDL (node + rel tables)
│   ├── loader.py         # read_collaborators(path) -> pd.DataFrame
│   ├── ingest.py         # Ingestor (init_schema, ingest, clear)
│   ├── viz.py            # build_networkx_graph + draw_graph (matplotlib)
│   ├── cli.py            # `collabgraph` Typer CLI
│   └── web/              # FastAPI backend (app, routes, services, cli)
├── tests/                # pytest suite
└── web/frontend/         # Vite + React + TypeScript app
```

## Requirements

- Python **3.11+**
- [`uv`](https://docs.astral.sh/uv/) (install: `pipx install uv` or
  `pip install uv`)
- Node.js 18+ and npm (only required to build / run the web app)

There is **no external database server** to install. Kùzu runs in-process
and persists everything to a single directory under `./data/`.

## Configure (`.env`)

A `.env` file is **optional**. Copy the template if you'd like to override
where Kùzu stores its data:

```bash
cp .env.example .env
```

| Variable               | Required | Default                   | Description                                  |
| ---------------------- | -------- | ------------------------- | -------------------------------------------- |
| `COLLABGRAPH_DB_PATH`  | no       | `./data/collabgraph.kuzu` | Filesystem path to the embedded Kuzu DB dir. |

`.env` is gitignored; `.env.example` is committed so contributors know what
to set.

## Storage

The embedded database lives in a single directory (default
`./data/collabgraph.kuzu/`) created the first time you run `init-schema` or
`ingest`. To back up your graph, just tar the directory along with your
source spreadsheet:

```bash
tar czf collabgraph-backup.tgz data/collabgraph.kuzu data/collaborators.xlsx
```

To wipe and re-init from scratch:

```bash
rm -rf data/collabgraph.kuzu
uv run collabgraph init-schema
uv run collabgraph ingest --path data/collaborators.xlsx
```

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
```

`collabgraph --help` lists every command and option.

## Use the Python API

```python
from collabgraph import (
    Ingestor,
    build_networkx_graph,
    draw_graph,
    load_settings,
    read_collaborators,
)

df = read_collaborators("data/collaborators.xlsx")

settings = load_settings()
with Ingestor(settings.db_path) as ing:
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

## Web app

A modern React + FastAPI web UI lives under [`web/frontend/`](web/frontend) and
[`src/collabgraph/web/`](src/collabgraph/web), with three views:

- **Setup** — live storage status, `init-schema`, ingest from an uploaded
  `.xlsx` (worksheet + column mapping), database stats panel, and a "danger zone"
  clear action.
- **Graph** — Cytoscape.js graph with selectable layout
  (`cose-bilkent`, `concentric`, `circle`, `grid`, `breadthfirst`),
  per-kind / per-sector color and shape palettes, sector / affiliation
  filters, label toggles, dynamic-physics drag, and PNG / JPEG / SVG / PDF
  export.
- **Map** — Leaflet basemap (OpenStreetMap, Carto Light, Carto Dark) with
  `Affiliation` markers and pop-ups listing collaborators and sectors. A
  toggle overlays "virtual links" between affiliations that share a sector,
  inspired by the
  [Neo4j geospatial graph visualization blog post](https://neo4j.com/blog/graph-visualization/mapping-a-connected-world-geospatial-graph-visualization/)
  (the same idea KeyLines uses for fraud-investigation views).

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

- `GET  /api/health` — connectivity check + resolved `db_path`.
- `GET  /api/settings` — `{db_path}`.
- `GET  /api/stats` — `{collaborators, sectors, affiliations, relationships}`.
- `POST /api/init-schema` — create node and relationship tables.
- `POST /api/ingest` — multipart upload (`file=<xlsx>`, `sheet=<name>`,
  optional `column_map_json`).
- `POST /api/clear` — delete all nodes/edges (use with care).
- `GET  /api/graph` — full graph payload `{nodes, edges}` for Cytoscape.
- `GET  /api/affiliations` — geocoded affiliations + collaborators + sectors.
- `GET  /api/affiliations/links` — virtual Affiliation⇄Affiliation links via
  shared sectors.
- `GET  /api/values/{sector|affiliation}` — distinct names for filter
  dropdowns.

Interactive OpenAPI docs are available at
<http://localhost:8000/docs> when the server is running.

## Deploying to a single Ubuntu 24.04 EC2 box

Because the database is embedded, deployment is just "Python + Node + a
filesystem path":

1. Provision an Ubuntu 24.04 instance, install `python3.11+`, `nodejs >=18`,
   and `uv`.
2. Clone this repo to e.g. `/opt/collabgraph`.
3. Install dependencies and build the frontend:

   ```bash
   cd /opt/collabgraph
   uv sync --extra web
   (cd web/frontend && npm install && npm run build)
   ```

4. Initialize the schema and ingest:

   ```bash
   uv run collabgraph init-schema
   uv run collabgraph ingest --path data/collaborators.xlsx
   ```

5. Run the web app under `systemd` (example unit
   `/etc/systemd/system/collabgraph.service`):

   ```ini
   [Unit]
   Description=collabgraph web app
   After=network.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/opt/collabgraph
   Environment=COLLABGRAPH_DB_PATH=/opt/collabgraph/data/collabgraph.kuzu
   ExecStart=/usr/local/bin/uv run collabgraph-web --host 0.0.0.0 --port 8000
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

   Then `sudo systemctl enable --now collabgraph`.

6. (Optional) Front the service with nginx + Let's Encrypt for HTTPS.
7. **Backups** — schedule a cron job that tars the data directory:

   ```bash
   tar czf /var/backups/collabgraph-$(date +%F).tgz \
       /opt/collabgraph/data/collabgraph.kuzu \
       /opt/collabgraph/data/collaborators.xlsx
   ```

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
