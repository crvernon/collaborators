import { useCallback, useEffect, useState } from "react";
import { Header, type ViewKey } from "./components/Header";
import { Toast, type ToastMessage } from "./components/Toast";
import { SetupView } from "./views/SetupView";
import { GraphView } from "./views/GraphView";
import { MapView } from "./views/MapView";
import {
  fetchHealth,
  fetchStats,
  type GraphStats,
  type HealthStatus,
} from "./lib/api";

export function App() {
  const [view, setView] = useState<ViewKey>("setup");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback(
    (kind: ToastMessage["kind"], text: string) => setToast({ kind, text }),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
      if (h.connected) {
        try {
          const s = await fetchStats();
          setStats(s);
        } catch {
          setStats(null);
        }
      }
    } catch {
      setHealth({
        connected: false,
        db_path: "",
        error: "Failed to reach API",
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <Header health={health} active={view} onChange={setView} />
      <div className="app-body">
        {view === "setup" && (
          <SetupView
            health={health}
            stats={stats}
            busy={busy}
            onBusy={setBusy}
            onStats={setStats}
            onToast={showToast}
            onRefresh={refresh}
          />
        )}
        {view === "graph" && <GraphView onToast={showToast} />}
        {view === "map" && <MapView onToast={showToast} />}
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
