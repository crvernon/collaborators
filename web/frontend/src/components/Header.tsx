import type { HealthStatus } from "../lib/api";

export type ViewKey = "setup" | "graph" | "map";

interface Props {
  health: HealthStatus | null;
  active: ViewKey;
  onChange: (k: ViewKey) => void;
}

const TABS: { key: ViewKey; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "graph", label: "Graph" },
  { key: "map", label: "Map" },
];

function shortenPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function Header({ health, active, onChange }: Props) {
  const dotClass = health ? (health.connected ? "ok" : "bad") : "";
  const label = health
    ? health.connected
      ? shortenPath(health.db_path)
      : "disconnected"
    : "checking…";
  return (
    <header className="app-header">
      <h1>collabgraph</h1>
      <span className="tag" title={health?.db_path ?? ""}>
        <span className={`dot ${dotClass}`} />
        {label}
      </span>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === active ? "active" : ""}
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
