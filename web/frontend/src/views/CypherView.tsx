import { useEffect, useMemo, useState } from "react";
import { fetchCypherList, runNamedCypher, type CypherList } from "../lib/api";

interface Props {
  onToast: (kind: "success" | "error" | "info", text: string) => void;
}

const PARAM_REGEX = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

function paramsIn(cypher: string): string[] {
  const out = new Set<string>();
  for (const match of cypher.matchAll(PARAM_REGEX)) {
    out.add(match[1]);
  }
  return [...out];
}

export function CypherView({ onToast }: Props) {
  const [list, setList] = useState<CypherList | null>(null);
  const [name, setName] = useState<string>("counts");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchCypherList()
      .then((l) => {
        setList(l);
        if (l.names.length > 0 && !l.names.includes(name)) setName(l.names[0]);
      })
      .catch((err) => {
        const e = err as { message?: string };
        onToast("error", `Failed to load examples: ${e?.message ?? String(err)}`);
      });
  }, []);

  const cypher = list?.snippets[name] ?? "";
  const params = useMemo(() => paramsIn(cypher), [cypher]);

  const onRun = async () => {
    setRunning(true);
    try {
      const result = await runNamedCypher(name, paramValues);
      setRows(result.rows);
      onToast("success", `Got ${result.rows.length} row(s)`);
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      onToast("error", e?.response?.data?.detail || e?.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="view">
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          <h2>Snippet</h2>
          <select
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setRows(null);
              setParamValues({});
            }}
          >
            {list?.names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          {params.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h2 style={{ fontSize: 12 }}>Parameters</h2>
              {params.map((p) => (
                <div key={p} style={{ marginBottom: 8 }}>
                  <label>{p}</label>
                  <input
                    type="text"
                    value={paramValues[p] ?? ""}
                    onChange={(e) =>
                      setParamValues((prev) => ({ ...prev, [p]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <button
            className="primary"
            onClick={onRun}
            disabled={running || !list}
            style={{ marginTop: 12 }}
          >
            Run
          </button>
        </div>
        <div className="card" style={{ flex: 2, minWidth: 360 }}>
          <h2>Cypher</h2>
          <pre className="code">{cypher || "—"}</pre>
        </div>
      </div>

      <div className="card">
        <h2>Results {rows ? `(${rows.length})` : ""}</h2>
        {rows && rows.length > 0 ? (
          <div style={{ overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c}>
                        {r[c] === null || r[c] === undefined
                          ? "—"
                          : typeof r[c] === "object"
                            ? JSON.stringify(r[c])
                            : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">{rows ? "No rows." : "Run a snippet to see results."}</div>
        )}
      </div>

      {list && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>Bloom perspective hint</h2>
          <pre className="code">{list.bloom_hint}</pre>
        </div>
      )}
    </div>
  );
}
