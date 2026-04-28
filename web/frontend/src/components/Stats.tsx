import type { GraphStats } from "../lib/api";

interface Props {
  stats: GraphStats | null;
}

export function StatsGrid({ stats }: Props) {
  const fmt = (n: number | undefined) =>
    typeof n === "number" ? n.toLocaleString() : "—";
  return (
    <div className="stats-grid">
      <div className="stat">
        <div className="label">Collaborators</div>
        <div className="value">{fmt(stats?.collaborators)}</div>
      </div>
      <div className="stat">
        <div className="label">Sectors</div>
        <div className="value">{fmt(stats?.sectors)}</div>
      </div>
      <div className="stat">
        <div className="label">Affiliations</div>
        <div className="value">{fmt(stats?.affiliations)}</div>
      </div>
      <div className="stat">
        <div className="label">Relationships</div>
        <div className="value">{fmt(stats?.relationships)}</div>
      </div>
    </div>
  );
}
