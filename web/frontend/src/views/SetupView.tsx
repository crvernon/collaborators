import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  clearGraph,
  fetchExcelColumns,
  fetchExcelSheets,
  ingestUpload,
  initSchema,
  type GraphStats,
  type HealthStatus,
} from "../lib/api";
import { StatsGrid } from "../components/Stats";

const FIELD_DEFS = [
  { key: "collaborator", label: "Collaborator", required: true },
  { key: "sector", label: "Sector", required: true },
  { key: "affiliation", label: "Affiliation", required: true },
  { key: "address", label: "Address", required: false },
  { key: "latitude", label: "Latitude", required: false },
  { key: "longitude", label: "Longitude", required: false },
  { key: "crs", label: "CRS", required: false },
] as const;

type FieldKey = (typeof FIELD_DEFS)[number]["key"];

function suggestColumnMapping(cols: string[]): Record<string, string> {
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const def of FIELD_DEFS) {
    const nk = norm(def.key);
    const exact = cols.find((c) => !taken.has(c) && norm(c) === nk);
    if (exact) {
      out[def.key] = exact;
      taken.add(exact);
      continue;
    }
    const loose = cols.find(
      (c) =>
        !taken.has(c) &&
        (norm(c).includes(nk) ||
          nk.includes(norm(c)) ||
          norm(c).endsWith(`_${nk}`)),
    );
    if (loose) {
      out[def.key] = loose;
      taken.add(loose);
    }
  }
  return out;
}

/** Pick a sensible default sheet: collaborators, data, sheet1, or first tab. */
function inferSheetName(sheets: string[]): string {
  if (sheets.length === 0) return "collaborators";
  const byLower = new Map(sheets.map((s) => [s.toLowerCase(), s] as const));
  for (const pref of ["collaborators", "data", "sheet1"]) {
    const hit = byLower.get(pref);
    if (hit) return hit;
  }
  return sheets[0];
}

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
  /** Selected worksheet in the uploaded file. */
  const [uploadSheet, setUploadSheet] = useState("");
  const [uploadSheets, setUploadSheets] = useState<string[] | null>(null);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileColumns, setFileColumns] = useState<string[] | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [columnsLoading, setColumnsLoading] = useState(false);

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

  const loadColumns = useCallback(
    async (f: File, sheetName: string) => {
      setColumnsLoading(true);
      try {
        const cols = await fetchExcelColumns(f, sheetName);
        setFileColumns(cols);
        setColumnMap(suggestColumnMapping(cols));
      } catch (err) {
        setFileColumns(null);
        setColumnMap({});
        const e = err as { response?: { data?: { detail?: string } }; message?: string };
        const msg = e?.response?.data?.detail || e?.message || String(err);
        onToast("error", `Could not read spreadsheet columns: ${msg}`);
      } finally {
        setColumnsLoading(false);
      }
    },
    [onToast],
  );

  useEffect(() => {
    if (uploadFile && uploadSheet) {
      void loadColumns(uploadFile, uploadSheet);
    }
  }, [uploadFile, uploadSheet, loadColumns]);

  const onInit = () =>
    guard("Init schema", async () => {
      await initSchema();
      await onRefresh();
    });

  const onIngestUpload = () =>
    guard("Ingest", async () => {
      const f = uploadFile ?? fileRef.current?.files?.[0];
      if (!f) {
        throw new Error("Choose an .xlsx file first");
      }
      for (const def of FIELD_DEFS) {
        if (def.required && !String(columnMap[def.key] ?? "").trim()) {
          throw new Error(`Map required field: ${def.label}`);
        }
      }
      const res = await ingestUpload(f, uploadSheet, columnMap);
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

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setUploadFile(f);
    setPicked(f?.name ?? null);
    setUploadSheets(null);
    setUploadSheet("");
    setFileColumns(null);
    setColumnMap({});
    if (!f) {
      setSheetsLoading(false);
      return;
    }
    setSheetsLoading(true);
    void fetchExcelSheets(f)
      .then((sheets) => {
        setUploadSheets(sheets);
        setUploadSheet(inferSheetName(sheets));
      })
      .catch((err) => {
        setUploadSheets(null);
        setUploadSheet("");
        const e = err as { response?: { data?: { detail?: string } }; message?: string };
        const msg = e?.response?.data?.detail || e?.message || String(err);
        onToast("error", `Could not read workbook sheets: ${msg}`);
      })
      .finally(() => setSheetsLoading(false));
  };

  const setMapField = (key: FieldKey, sourceCol: string) => {
    setColumnMap((prev) => ({ ...prev, [key]: sourceCol }));
  };

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
                Database path: <code>{health.db_path || "(unknown)"}</code>
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
            Creates the Collaborator, Sector, and Affiliation node tables plus
            the AFFILIATED_WITH, WORKS_IN, and PRESENT_AT relationship tables in
            the embedded Kuzu database. Safe to re-run.
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
            All writes use MERGE, so re-ingesting updates in place. Upload an
            .xlsx file, pick the worksheet, then map your spreadsheet columns to
            the fields the app expects (names are normalized after mapping).
          </p>
          <div className="row" style={{ alignItems: "end", flexWrap: "wrap", gap: 12 }}>
            <div className="field" style={{ display: "flex", flexDirection: "column" }}>
              <label>Excel upload (.xlsx)</label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                onChange={onFileChange}
              />
              {picked && <span className="muted">selected: {picked}</span>}
            </div>
            {uploadFile && (
              <div className="field" style={{ display: "flex", flexDirection: "column" }}>
                <label>Sheet in uploaded file</label>
                {sheetsLoading ? (
                  <span className="muted" style={{ padding: "8px 0" }}>
                    Loading sheets…
                  </span>
                ) : uploadSheets && uploadSheets.length > 0 ? (
                  <select
                    value={uploadSheet}
                    onChange={(e) => setUploadSheet(e.target.value)}
                    aria-label="Worksheet in uploaded Excel file"
                  >
                    {uploadSheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted" style={{ padding: "8px 0" }}>
                    No sheets loaded
                  </span>
                )}
              </div>
            )}
          </div>

          {uploadFile && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 13 }}>Column mapping</h3>
                {columnsLoading && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Reading headers…
                  </span>
                )}
                {fileColumns && !columnsLoading && (
                  <button
                    type="button"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setColumnMap(suggestColumnMapping(fileColumns))}
                  >
                    Autodetect again
                  </button>
                )}
              </div>
              {!fileColumns && !columnsLoading && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Choose a file to load column headers.
                </p>
              )}
              {fileColumns && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ minWidth: 420 }}>
                    <thead>
                      <tr>
                        <th>App field</th>
                        <th>Your column</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FIELD_DEFS.map((def) => (
                        <tr key={def.key}>
                          <td>
                            {def.label}
                            {def.required ? (
                              <span style={{ color: "var(--danger)" }}> *</span>
                            ) : null}
                          </td>
                          <td>
                            <select
                              value={columnMap[def.key] ?? ""}
                              onChange={(e) =>
                                setMapField(def.key, e.target.value)
                              }
                              style={{ minWidth: 220 }}
                              aria-label={`Map ${def.label}`}
                            >
                              <option value="">
                                {def.required ? "— select column —" : "— not mapped —"}
                              </option>
                              {fileColumns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              className="primary"
              onClick={onIngestUpload}
              disabled={
                busy ||
                !health?.connected ||
                !uploadFile ||
                !uploadSheet ||
                sheetsLoading ||
                columnsLoading ||
                !fileColumns
              }
            >
              Ingest
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
