import type { HealthStatus } from "../lib/api";

export type ViewKey = "setup" | "graph" | "map" | "cypher";

interface Props {
  health: HealthStatus | null;
  active: ViewKey;
  onChange: (k: ViewKey) => void;
}

const TABS: { key: ViewKey; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "graph", label: "Graph" },
  { key: "map", label: "Map" },
  { key: "cypher", label: "Cypher" },
];

export function Header({ health, active, onChange }: Props) {
  const dotClass = health ? (health.connected ? "ok" : "bad") : "";
  const label = health
    ? health.connected
      ? `${health.user}@${health.uri.replace(/^bolt:\/\//, "")}/${health.database}`
      : "disconnected"
    : "checking…";
  return (
    <header className="app-header">
      <h1>collabgraph</h1>
      <span className="tag">
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
