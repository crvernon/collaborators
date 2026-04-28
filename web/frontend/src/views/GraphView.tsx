import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";
import {
  fetchGraph,
  fetchValues,
  type GraphPayload,
  type NodeKind,
} from "../lib/api";
import { NODE_COLORS, NODE_SIZES } from "../lib/palette";

cytoscape.use(coseBilkent);

const LAYOUTS = [
  { id: "cose-bilkent", label: "Force (cose-bilkent)" },
  { id: "concentric", label: "Concentric" },
  { id: "circle", label: "Circle" },
  { id: "grid", label: "Grid" },
  { id: "breadthfirst", label: "Breadth-first" },
];

interface Props {
  onToast: (kind: "success" | "error" | "info", text: string) => void;
}

export function GraphView({ onToast }: Props) {
  const cyHostRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [data, setData] = useState<GraphPayload | null>(null);
  const [layout, setLayout] = useState("cose-bilkent");
  const [showLabels, setShowLabels] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [enabledKinds, setEnabledKinds] = useState<Record<NodeKind, boolean>>({
    Collaborator: true,
    Sector: true,
    Affiliation: true,
  });
  const [sectors, setSectors] = useState<string[]>([]);
  const [affiliations, setAffiliations] = useState<string[]>([]);
  const [filterSector, setFilterSector] = useState("");
  const [filterAffiliation, setFilterAffiliation] = useState("");
  const [loading, setLoading] = useState(false);

  const styleSheet = useMemo<cytoscape.StylesheetJson>(
    () => [
      {
        selector: "node",
        style: {
          "background-color": (ele: cytoscape.NodeSingular) =>
            NODE_COLORS[ele.data("kind") as NodeKind] ?? "#888",
          width: (ele: cytoscape.NodeSingular) =>
            NODE_SIZES[ele.data("kind") as NodeKind] ?? 30,
          height: (ele: cytoscape.NodeSingular) =>
            NODE_SIZES[ele.data("kind") as NodeKind] ?? 30,
          label: showLabels ? "data(name)" : "",
          color: "#e5e7eb",
          "font-size": 11,
          "text-outline-color": "#0f172a",
          "text-outline-width": 2,
          "text-valign": "center",
          "text-halign": "center",
          "border-color": "#0f172a",
          "border-width": 1,
        } as cytoscape.Css.Node,
      },
      {
        selector: "edge",
        style: {
          width: 1.4,
          "line-color": "#475569",
          "target-arrow-color": "#475569",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          label: showEdgeLabels ? "data(rel)" : "",
          "font-size": 9,
          color: "#cbd5e1",
          "text-rotation": "autorotate",
          "text-background-color": "#0f172a",
          "text-background-opacity": 0.85,
          "text-background-padding": "2px",
        } as cytoscape.Css.Edge,
      },
      {
        selector: "node:selected",
        style: { "border-color": "#fde68a", "border-width": 3 } as cytoscape.Css.Node,
      },
    ],
    [showLabels, showEdgeLabels],
  );

  const reload = async () => {
    setLoading(true);
    try {
      const [g, sec, aff] = await Promise.all([
        fetchGraph(),
        fetchValues("sector"),
        fetchValues("affiliation"),
      ]);
      setData(g);
      setSectors(sec);
      setAffiliations(aff);
    } catch (err) {
      const e = err as { message?: string };
      onToast("error", `Failed to load graph: ${e?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // Collaborator IDs that should be visible based on filters.
  const visibleCollabIds = useMemo(() => {
    if (!data) return new Set<string>();
    if (!filterSector && !filterAffiliation) {
      return new Set(
        data.nodes.filter((n) => n.kind === "Collaborator").map((n) => n.id),
      );
    }
    const sectorByName = new Map(
      data.nodes
        .filter((n) => n.kind === "Sector")
        .map((n) => [n.name, n.id] as const),
    );
    const affByName = new Map(
      data.nodes
        .filter((n) => n.kind === "Affiliation")
        .map((n) => [n.name, n.id] as const),
    );
    const sectorId = filterSector ? sectorByName.get(filterSector) : null;
    const affId = filterAffiliation ? affByName.get(filterAffiliation) : null;

    const collabIds = new Set<string>();
    for (const n of data.nodes) {
      if (n.kind !== "Collaborator") continue;
      let okSector = !sectorId;
      let okAff = !affId;
      for (const e of data.edges) {
        if (e.source !== n.id) continue;
        if (sectorId && e.rel === "WORKS_IN" && e.target === sectorId)
          okSector = true;
        if (affId && e.rel === "AFFILIATED_WITH" && e.target === affId)
          okAff = true;
      }
      if (okSector && okAff) collabIds.add(n.id);
    }
    return collabIds;
  }, [data, filterSector, filterAffiliation]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const keep = new Set<string>();
    for (const id of visibleCollabIds) keep.add(id);
    for (const e of data.edges) {
      if (visibleCollabIds.has(e.source)) keep.add(e.target);
    }
    const filteredNodes = data.nodes.filter(
      (n) => keep.has(n.id) && enabledKinds[n.kind],
    );
    const allowedIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = data.edges.filter(
      (e) => allowedIds.has(e.source) && allowedIds.has(e.target),
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }, [data, visibleCollabIds, enabledKinds]);

  useEffect(() => {
    if (!cyHostRef.current || !filtered) return;
    if (cyRef.current) {
      cyRef.current.destroy();
    }
    const cy = cytoscape({
      container: cyHostRef.current,
      elements: [
        ...filtered.nodes.map((n) => ({
          data: { id: n.id, name: n.name, kind: n.kind, address: n.address },
        })),
        ...filtered.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            rel: e.rel,
          },
        })),
      ],
      style: styleSheet,
      layout: { name: layout, animate: false } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [filtered, styleSheet, layout]);

  const onExport = () => {
    if (!cyRef.current) return;
    const png = cyRef.current.png({ full: true, bg: "#0f172a", scale: 2 });
    const a = document.createElement("a");
    a.href = png;
    a.download = "collabgraph.png";
    a.click();
  };

  const toggleKind = (k: NodeKind) =>
    setEnabledKinds((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="toolbar">
        <div className="field">
          <label>Layout</label>
          <select value={layout} onChange={(e) => setLayout(e.target.value)}>
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Sector filter</label>
          <select
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
          >
            <option value="">— any —</option>
            {sectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Affiliation filter</label>
          <select
            value={filterAffiliation}
            onChange={(e) => setFilterAffiliation(e.target.value)}
          >
            <option value="">— any —</option>
            {affiliations.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Visible kinds</label>
          <div style={{ display: "flex", gap: 6 }}>
            {(Object.keys(enabledKinds) as NodeKind[]).map((k) => (
              <button
                key={k}
                onClick={() => toggleKind(k)}
                style={{
                  borderColor: enabledKinds[k] ? NODE_COLORS[k] : "var(--border)",
                  color: enabledKinds[k] ? NODE_COLORS[k] : "var(--muted)",
                  fontSize: 12,
                  padding: "5px 10px",
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Labels</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setShowLabels((s) => !s)}
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              {showLabels ? "Names: on" : "Names: off"}
            </button>
            <button
              onClick={() => setShowEdgeLabels((s) => !s)}
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              {showEdgeLabels ? "Edges: on" : "Edges: off"}
            </button>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={reload} disabled={loading}>
            Refresh
          </button>
          <button className="primary" onClick={onExport}>
            Export PNG
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <div className="legend">
          {(Object.keys(NODE_COLORS) as NodeKind[]).map((k) => (
            <span key={k}>
              <span className="swatch" style={{ background: NODE_COLORS[k] }} />
              {k}
            </span>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered
            ? `${filtered.nodes.length} nodes · ${filtered.edges.length} edges`
            : "—"}
        </span>
      </div>

      <div ref={cyHostRef} className="cy-host" />
    </div>
  );
}
