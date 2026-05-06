import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";
import {
  fetchGraph,
  fetchValues,
  type GraphEdge,
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

const RELATIONSHIP_TYPES = ["AFFILIATED_WITH", "WORKS_IN", "PRESENT_AT"] as const;
type RelationshipType = GraphEdge["rel"];

const DEFAULT_EDGE_COLORS: Record<RelationshipType, string> = {
  AFFILIATED_WITH: "#7c3aed",
  WORKS_IN: "#0ea5e9",
  PRESENT_AT: "#f59e0b",
};
const DEFAULT_EDGE_WIDTHS: Record<RelationshipType, number> = {
  AFFILIATED_WITH: 1.8,
  WORKS_IN: 1.8,
  PRESENT_AT: 1.8,
};
const GRAPH_STYLE_STORAGE_KEY = "collabgraph.graph.styles.v1";

type GraphStyleConfig = {
  nodeColors: Record<NodeKind, string>;
  nodeSizes: Record<NodeKind, number>;
  edgeColors: Record<RelationshipType, string>;
  edgeWidths: Record<RelationshipType, number>;
  nodeLabelFontFamily: string;
  nodeLabelFontSize: number;
};

function readSavedGraphStyles(): GraphStyleConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GRAPH_STYLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GraphStyleConfig>;
    if (
      !parsed.nodeColors ||
      !parsed.nodeSizes ||
      !parsed.edgeColors ||
      !parsed.edgeWidths ||
      typeof parsed.nodeLabelFontFamily !== "string" ||
      typeof parsed.nodeLabelFontSize !== "number"
    ) {
      return null;
    }
    return {
      nodeColors: { ...NODE_COLORS, ...parsed.nodeColors },
      nodeSizes: { ...NODE_SIZES, ...parsed.nodeSizes },
      edgeColors: { ...DEFAULT_EDGE_COLORS, ...parsed.edgeColors },
      edgeWidths: { ...DEFAULT_EDGE_WIDTHS, ...parsed.edgeWidths },
      nodeLabelFontFamily: parsed.nodeLabelFontFamily,
      nodeLabelFontSize: parsed.nodeLabelFontSize,
    };
  } catch {
    return null;
  }
}

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
  const [dynamicPhysics, setDynamicPhysics] = useState(false);
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
  const [nodeColors, setNodeColors] = useState<Record<NodeKind, string>>(
    () => readSavedGraphStyles()?.nodeColors ?? NODE_COLORS,
  );
  const [nodeSizes, setNodeSizes] = useState<Record<NodeKind, number>>(
    () => readSavedGraphStyles()?.nodeSizes ?? NODE_SIZES,
  );
  const [edgeColors, setEdgeColors] = useState<Record<RelationshipType, string>>(
    () => readSavedGraphStyles()?.edgeColors ?? DEFAULT_EDGE_COLORS,
  );
  const [edgeWidths, setEdgeWidths] = useState<Record<RelationshipType, number>>(
    () => readSavedGraphStyles()?.edgeWidths ?? DEFAULT_EDGE_WIDTHS,
  );
  const [nodeLabelFontFamily, setNodeLabelFontFamily] = useState<string>(
    () => readSavedGraphStyles()?.nodeLabelFontFamily ?? "Arial",
  );
  const [nodeLabelFontSize, setNodeLabelFontSize] = useState<number>(
    () => readSavedGraphStyles()?.nodeLabelFontSize ?? 11,
  );

  const styleSheet = useMemo<cytoscape.StylesheetJson>(
    () => [
      {
        selector: "node",
        style: {
          label: showLabels ? "data(name)" : "",
          color: "#e5e7eb",
          "text-outline-color": "#0f172a",
          "text-outline-width": 2,
          "text-valign": "center",
          "text-halign": "center",
          "border-color": "#0f172a",
          "border-width": 1,
          "font-family": nodeLabelFontFamily,
          "font-size": nodeLabelFontSize,
        } as cytoscape.Css.Node,
      },
      ...(Object.keys(nodeColors) as NodeKind[]).map((kind) => ({
        selector: `node[kind = "${kind}"]`,
        style: {
          "background-color": nodeColors[kind],
          width: nodeSizes[kind],
          height: nodeSizes[kind],
        } as cytoscape.Css.Node,
      })),
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
      ...RELATIONSHIP_TYPES.map((rel) => ({
        selector: `edge[rel = "${rel}"]`,
        style: {
          width: edgeWidths[rel],
          "line-color": edgeColors[rel],
          "target-arrow-color": edgeColors[rel],
        } as cytoscape.Css.Edge,
      })),
      {
        selector: "node:selected",
        style: { "border-color": "#fde68a", "border-width": 3 } as cytoscape.Css.Node,
      },
    ],
    [
      showLabels,
      showEdgeLabels,
      nodeColors,
      nodeSizes,
      edgeColors,
      edgeWidths,
      nodeLabelFontFamily,
      nodeLabelFontSize,
    ],
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

    const rerunDynamicLayout = (anchorNode: cytoscape.NodeSingular) => {
      if (!dynamicPhysics) return;
      const nodeId = anchorNode.id();
      const pos = anchorNode.position();
      // Keep the dragged node anchored while recomputing nearby force layout.
      anchorNode.lock();
      const run = cy.layout({
        name: "cose-bilkent",
        animate: "end",
        randomize: false,
        fit: false,
        nodeDimensionsIncludeLabels: true,
      } as cytoscape.LayoutOptions);
      run.run();
      run.one("layoutstop", () => {
        const n = cy.getElementById(nodeId);
        if (n.nonempty()) {
          n.position(pos);
          n.unlock();
        }
      });
    };

    const onDragFree = (evt: cytoscape.EventObject) => {
      const node = evt.target as cytoscape.NodeSingular;
      rerunDynamicLayout(node);
    };
    cy.on("dragfree", "node", onDragFree);

    cyRef.current = cy;
    return () => {
      cy.removeListener("dragfree", "node", onDragFree);
      cy.destroy();
      cyRef.current = null;
    };
  }, [filtered, styleSheet, layout, dynamicPhysics]);

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

  const resetStyles = () => {
    setNodeColors(NODE_COLORS);
    setNodeSizes(NODE_SIZES);
    setEdgeColors(DEFAULT_EDGE_COLORS);
    setEdgeWidths(DEFAULT_EDGE_WIDTHS);
    setNodeLabelFontFamily("Arial");
    setNodeLabelFontSize(11);
  };

  const saveStyles = () => {
    try {
      const payload: GraphStyleConfig = {
        nodeColors,
        nodeSizes,
        edgeColors,
        edgeWidths,
        nodeLabelFontFamily,
        nodeLabelFontSize,
      };
      window.localStorage.setItem(GRAPH_STYLE_STORAGE_KEY, JSON.stringify(payload));
      onToast("success", "Graph styles saved.");
    } catch {
      onToast("error", "Failed to save graph styles.");
    }
  };

  const loadStyles = () => {
    const saved = readSavedGraphStyles();
    if (!saved) {
      onToast("info", "No saved graph styles found.");
      return;
    }
    setNodeColors(saved.nodeColors);
    setNodeSizes(saved.nodeSizes);
    setEdgeColors(saved.edgeColors);
    setEdgeWidths(saved.edgeWidths);
    setNodeLabelFontFamily(saved.nodeLabelFontFamily);
    setNodeLabelFontSize(saved.nodeLabelFontSize);
    onToast("success", "Saved graph styles loaded.");
  };

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
        <div className="field">
          <label>Dynamic force</label>
          <button
            onClick={() => setDynamicPhysics((v) => !v)}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {dynamicPhysics ? "Dynamic: on" : "Dynamic: off"}
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={saveStyles}>Save styles</button>
          <button onClick={loadStyles}>Load styles</button>
          <button onClick={resetStyles}>Reset styles</button>
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
          {(Object.keys(nodeColors) as NodeKind[]).map((k) => (
            <span key={k}>
              <span className="swatch" style={{ background: nodeColors[k] }} />
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

      <div className="toolbar" style={{ paddingTop: 6, paddingBottom: 10 }}>
        {(Object.keys(nodeColors) as NodeKind[]).map((k) => (
          <div key={`node-style-${k}`} className="field">
            <label>{k} node</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                value={nodeColors[k]}
                onChange={(e) =>
                  setNodeColors((prev) => ({ ...prev, [k]: e.target.value }))
                }
                aria-label={`${k} node color`}
              />
              <input
                type="number"
                min={12}
                max={120}
                step={2}
                value={nodeSizes[k]}
                onChange={(e) =>
                  setNodeSizes((prev) => ({
                    ...prev,
                    [k]: Number(e.target.value) || prev[k],
                  }))
                }
                style={{ width: 84, minWidth: 84 }}
                aria-label={`${k} node size`}
              />
            </div>
          </div>
        ))}
        {RELATIONSHIP_TYPES.map((rel) => (
          <div key={`edge-style-${rel}`} className="field">
            <label>{rel} edge</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                value={edgeColors[rel]}
                onChange={(e) =>
                  setEdgeColors((prev) => ({ ...prev, [rel]: e.target.value }))
                }
                aria-label={`${rel} edge color`}
              />
              <input
                type="number"
                min={0.5}
                max={8}
                step={0.1}
                value={edgeWidths[rel]}
                onChange={(e) =>
                  setEdgeWidths((prev) => ({
                    ...prev,
                    [rel]: Number(e.target.value) || prev[rel],
                  }))
                }
                style={{ width: 84, minWidth: 84 }}
                aria-label={`${rel} edge width`}
              />
            </div>
          </div>
        ))}
        <div className="field">
          <label>Node label font</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              value={nodeLabelFontFamily}
              onChange={(e) => setNodeLabelFontFamily(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="Arial">Arial</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Verdana">Verdana</option>
              <option value="Tahoma">Tahoma</option>
              <option value="Trebuchet MS">Trebuchet MS</option>
              <option value="Georgia">Georgia</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
            </select>
            <input
              type="number"
              min={8}
              max={32}
              step={1}
              value={nodeLabelFontSize}
              onChange={(e) => setNodeLabelFontSize(Number(e.target.value) || 11)}
              style={{ width: 84, minWidth: 84 }}
              aria-label="Node label font size"
            />
          </div>
        </div>
      </div>

      <div ref={cyHostRef} className="cy-host" />
    </div>
  );
}
