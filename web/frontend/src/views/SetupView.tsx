import { useRef, useState } from "react";
import {
  clearGraph,
  ingestDefault,
  ingestUpload,
  initSchema,
  type GraphStats,
  type HealthStatus,
} from "../lib/api";
import { StatsGrid } from "../components/Stats";

interface Props {
  health: HealthStatus | null;
  stats: GraphStats | null;
  busy: boolean;
  onBusy: (b: boolean) => void;
  onStats: (s: GraphStats) => void;
  onToast: (kind: "success" | "error" | "info", text: string) => void;
  onRefresh: () => Promise<void>;
}

export function SetupView({
  health,
  stats,
  busy,
  onBusy,
  onStats,
  onToast,
  onRefresh,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sheet, setSheet] = useState("collaborators");
  const [picked, setPicked] = useState<string | null>(null);

  const guard = async (label: string, fn: () => Promise<void>) => {
    onBusy(true);
    try {
      await fn();
      onToast("success", `${label} succeeded`);
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      const msg = e?.response?.data?.detail || e?.message || String(err);
      onToast("error", `${label} failed: ${msg}`);
    } finally {
      onBusy(false);
    }
  };

  const onInit = () =>
    guard("Init schema", async () => {
      await initSchema();
      await onRefresh();
    });

  const onIngestDefault = () =>
    guard("Ingest default file", async () => {
      const res = await ingestDefault(sheet);
      onStats(res.stats);
      onToast("success", `Ingested ${res.rows} row(s) from default file`);
    });

  const onIngestUpload = () =>
    guard("Upload + ingest", async () => {
      const f = fileRef.current?.files?.[0];
      if (!f) {
        throw new Error("Choose an .xlsx file first");
      }
      const res = await ingestUpload(f, sheet);
      onStats(res.stats);
      onToast("success", `Ingested ${res.rows} row(s) from ${f.name}`);
    });

  const onClear = () =>
    guard("Clear graph", async () => {
      if (!confirm("Delete every node and relationship in the database?")) {
        throw new Error("cancelled");
      }
      await clearGraph();
      await onRefresh();
    });

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="card" style={{ flex: 2, minWidth: 320 }}>
          <h2>Connection</h2>
          {health ? (
            <div>
              <div>
                <strong>Status:</strong>{" "}
                {health.connected ? (
                  <span style={{ color: "var(--success)" }}>connected</span>
                ) : (
                  <span style={{ color: "var(--danger)" }}>disconnected</span>
                )}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {health.uri} · user {health.user} · db {health.database}
              </div>
              {!health.connected && health.error && (
                <pre className="code" style={{ marginTop: 10 }}>
                  {health.error}
                </pre>
              )}
            </div>
          ) : (
            <div className="muted">Checking…</div>
          )}
        </div>
        <div className="card" style={{ flex: 3, minWidth: 360 }}>
          <h2>Database stats</h2>
          <StatsGrid stats={stats} />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <h2>1. Initialize schema</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Creates uniqueness constraints on Collaborator, Sector, and Affiliation
            and an index on Affiliation lat/lon. Safe to re-run.
          </p>
          <button
            className="primary"
            onClick={onInit}
            disabled={busy || !health?.connected}
          >
            Run init-schema
          </button>
        </div>

        <div className="card" style={{ flex: 2, minWidth: 360 }}>
          <h2>2. Ingest data</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            All writes use MERGE, so re-ingesting updates in place.
          </p>
          <div className="row" style={{ alignItems: "end" }}>
            <div className="field" style={{ display: "flex", flexDirection: "column" }}>
              <label>Sheet name</label>
              <input
                type="text"
                value={sheet}
                onChange={(e) => setSheet(e.target.value)}
              />
            </div>
            <div className="field" style={{ display: "flex", flexDirection: "column" }}>
              <label>Excel upload (.xlsx)</label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                onChange={(e) => setPicked(e.target.files?.[0]?.name ?? null)}
              />
              {picked && <span className="muted">selected: {picked}</span>}
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              onClick={onIngestUpload}
              disabled={busy || !health?.connected}
            >
              Upload + ingest
            </button>
            <button
              className="primary"
              onClick={onIngestDefault}
              disabled={busy || !health?.connected}
            >
              Ingest default (data/collaborators.xlsx)
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Deletes every node and relationship in the configured database.
        </p>
        <button
          className="danger"
          onClick={onClear}
          disabled={busy || !health?.connected}
        >
          Clear graph
        </button>
      </div>
    </div>
  );
}
