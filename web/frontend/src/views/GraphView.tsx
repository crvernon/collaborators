import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";
import cytoscapeSvg from "cytoscape-svg";
import { jsPDF } from "jspdf";
import {
  fetchGraph,
  fetchValues,
  type GraphEdge,
  type GraphPayload,
  type NodeKind,
} from "../lib/api";
import { NODE_COLORS, NODE_SIZES } from "../lib/palette";

cytoscape.use(coseBilkent);
cytoscape.use(cytoscapeSvg);

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
type ExportFormat = "png" | "jpeg" | "svg" | "pdf";
type SidebarTab = "styles" | "export";

const SECTOR_SHAPE_OPTIONS = [
  "ellipse",
  "round-rectangle",
  "rectangle",
  "triangle",
  "round-triangle",
  "diamond",
  "pentagon",
  "round-pentagon",
  "hexagon",
  "round-hexagon",
  "heptagon",
  "octagon",
  "star",
  "vee",
] as const;
type NodeShape = (typeof SECTOR_SHAPE_OPTIONS)[number];
type SectorStyle = { color: string; shape: NodeShape };
type SectorPalette = Record<string, SectorStyle>;

function _hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) =>
    lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function randomSectorColor(seedHue?: number): string {
  const h = seedHue ?? Math.floor(Math.random() * 360);
  const s = 60 + Math.floor(Math.random() * 25);
  const l = 50 + Math.floor(Math.random() * 12);
  return _hslToHex(h, s, l);
}

function randomSectorShape(): NodeShape {
  return SECTOR_SHAPE_OPTIONS[
    Math.floor(Math.random() * SECTOR_SHAPE_OPTIONS.length)
  ];
}

function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type GraphStyleConfig = {
  nodeColors: Record<NodeKind, string>;
  nodeSizes: Record<NodeKind, number>;
  edgeColors: Record<RelationshipType, string>;
  edgeWidths: Record<RelationshipType, number>;
  nodeLabelFontFamily: string;
  nodeLabelFontSize: number;
  graphBackground: string;
  sectorPalette: SectorPalette;
  colorAffiliationsBySector: boolean;
  shapeSectorsBySector: boolean;
  showNodeLegend: boolean;
};

function readSavedGraphStyles(): GraphStyleConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GRAPH_STYLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GraphStyleConfig>;
    if (!parsed.nodeColors || !parsed.nodeSizes || !parsed.edgeColors || !parsed.edgeWidths) {
      return null;
    }
    return {
      nodeColors: { ...NODE_COLORS, ...parsed.nodeColors },
      nodeSizes: { ...NODE_SIZES, ...parsed.nodeSizes },
      edgeColors: { ...DEFAULT_EDGE_COLORS, ...parsed.edgeColors },
      edgeWidths: { ...DEFAULT_EDGE_WIDTHS, ...parsed.edgeWidths },
      nodeLabelFontFamily:
        typeof parsed.nodeLabelFontFamily === "string"
          ? parsed.nodeLabelFontFamily
          : "Arial",
      nodeLabelFontSize:
        typeof parsed.nodeLabelFontSize === "number"
          ? parsed.nodeLabelFontSize
          : 11,
      graphBackground:
        typeof parsed.graphBackground === "string" ? parsed.graphBackground : "#0b1220",
      sectorPalette:
        parsed.sectorPalette && typeof parsed.sectorPalette === "object"
          ? (parsed.sectorPalette as SectorPalette)
          : {},
      colorAffiliationsBySector:
        typeof parsed.colorAffiliationsBySector === "boolean"
          ? parsed.colorAffiliationsBySector
          : false,
      shapeSectorsBySector:
        typeof parsed.shapeSectorsBySector === "boolean"
          ? parsed.shapeSectorsBySector
          : false,
      showNodeLegend:
        typeof parsed.showNodeLegend === "boolean"
          ? parsed.showNodeLegend
          : false,
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
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
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
  const [graphBackground, setGraphBackground] = useState<string>(
    () => readSavedGraphStyles()?.graphBackground ?? "#0b1220",
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportDpi, setExportDpi] = useState<number>(300);
  const [exportNoBackground, setExportNoBackground] = useState(false);
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("styles");
  const [sectorPalette, setSectorPalette] = useState<SectorPalette>(
    () => readSavedGraphStyles()?.sectorPalette ?? {},
  );
  const [colorAffiliationsBySector, setColorAffiliationsBySector] =
    useState<boolean>(
      () => readSavedGraphStyles()?.colorAffiliationsBySector ?? false,
    );
  const [shapeSectorsBySector, setShapeSectorsBySector] = useState<boolean>(
    () => readSavedGraphStyles()?.shapeSectorsBySector ?? false,
  );
  const [showNodeLegend, setShowNodeLegend] = useState<boolean>(
    () => readSavedGraphStyles()?.showNodeLegend ?? false,
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
      ...(colorAffiliationsBySector
        ? Object.entries(sectorPalette).flatMap(([sectorName, ss]) => {
            const escaped = escapeSelectorValue(sectorName);
            return [
              {
                selector: `node[kind = "Affiliation"][primarySector = "${escaped}"]`,
                style: { "background-color": ss.color } as cytoscape.Css.Node,
              },
              {
                selector: `node[kind = "Sector"][name = "${escaped}"]`,
                style: { "background-color": ss.color } as cytoscape.Css.Node,
              },
            ];
          })
        : []),
      ...(shapeSectorsBySector
        ? Object.entries(sectorPalette).flatMap(([sectorName, ss]) => {
            const escaped = escapeSelectorValue(sectorName);
            return [
              {
                selector: `node[kind = "Sector"][name = "${escaped}"]`,
                style: { shape: ss.shape } as cytoscape.Css.Node,
              },
              {
                selector: `node[kind = "Affiliation"][primarySector = "${escaped}"]`,
                style: { shape: ss.shape } as cytoscape.Css.Node,
              },
            ];
          })
        : []),
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
      sectorPalette,
      colorAffiliationsBySector,
      shapeSectorsBySector,
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

  // Auto-fill sector palette entries for any sector we don't yet have a
  // color/shape for. Existing entries (and user overrides) are preserved.
  useEffect(() => {
    if (sectors.length === 0) return;
    setSectorPalette((prev) => {
      let changed = false;
      const next: SectorPalette = { ...prev };
      const step = 360 / Math.max(sectors.length, 1);
      sectors.forEach((s, i) => {
        if (!next[s]) {
          next[s] = {
            color: randomSectorColor(Math.floor((i * step) % 360)),
            shape: randomSectorShape(),
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sectors]);

  // Map every Affiliation node id to the (alphabetically first) Sector it is
  // co-located with via PRESENT_AT. Used for "color affiliations by sector".
  const affiliationPrimarySector = useMemo(() => {
    const result = new Map<string, string>();
    if (!data) return result;
    const sectorIdToName = new Map(
      data.nodes
        .filter((n) => n.kind === "Sector")
        .map((n) => [n.id, n.name] as const),
    );
    const buckets = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.rel !== "PRESENT_AT") continue;
      const sectorName = sectorIdToName.get(e.source);
      if (!sectorName) continue;
      if (!buckets.has(e.target)) buckets.set(e.target, []);
      buckets.get(e.target)!.push(sectorName);
    }
    for (const [affId, secs] of buckets) {
      secs.sort();
      result.set(affId, secs[0]);
    }
    return result;
  }, [data]);

  // Restrict to the 1-hop neighborhood of any active filter anchor.
  // - Sector filter: keep the sector + its directly connected collaborators
  //   (WORKS_IN) and affiliations (PRESENT_AT) only.
  // - Affiliation filter: keep the affiliation + its directly connected
  //   collaborators (AFFILIATED_WITH) and sectors (PRESENT_AT) only.
  // - Both active: intersect the two neighborhoods.
  const filtered = useMemo(() => {
    if (!data) return null;

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

    const directNeighborhood = (anchorId: string): Set<string> => {
      const hood = new Set<string>([anchorId]);
      for (const e of data.edges) {
        if (e.source === anchorId) hood.add(e.target);
        else if (e.target === anchorId) hood.add(e.source);
      }
      return hood;
    };

    const anchorSets: Set<string>[] = [];
    if (sectorId) anchorSets.push(directNeighborhood(sectorId));
    if (affId) anchorSets.push(directNeighborhood(affId));

    let keep: Set<string>;
    if (anchorSets.length === 0) {
      keep = new Set(data.nodes.map((n) => n.id));
    } else {
      keep = anchorSets.reduce<Set<string>>((acc, s, idx) => {
        if (idx === 0) return new Set(s);
        return new Set([...acc].filter((id) => s.has(id)));
      }, new Set<string>());
    }

    const filteredNodes = data.nodes.filter(
      (n) => keep.has(n.id) && enabledKinds[n.kind],
    );
    const allowedIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = data.edges.filter(
      (e) => allowedIds.has(e.source) && allowedIds.has(e.target),
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }, [data, filterSector, filterAffiliation, enabledKinds]);

  const legendEntries = useMemo(() => {
    if (!filtered) return [] as Array<{ label: string; color: string; shape: string }>;
    const entries: Array<{ label: string; color: string; shape: string }> = [];

    const byKind = {
      Collaborator: filtered.nodes.filter((n) => n.kind === "Collaborator"),
      Sector: filtered.nodes.filter((n) => n.kind === "Sector"),
      Affiliation: filtered.nodes.filter((n) => n.kind === "Affiliation"),
    };

    if (byKind.Collaborator.length > 0) {
      entries.push({
        label: `Collaborator (${byKind.Collaborator.length})`,
        color: nodeColors.Collaborator,
        shape: "ellipse",
      });
    }

    if (byKind.Sector.length > 0) {
      if (colorAffiliationsBySector || shapeSectorsBySector) {
        for (const n of byKind.Sector) {
          const ss = sectorPalette[n.name];
          entries.push({
            label: `Sector: ${n.name}`,
            color: ss?.color ?? nodeColors.Sector,
            shape: ss?.shape ?? "ellipse",
          });
        }
      } else {
        entries.push({
          label: `Sector (${byKind.Sector.length})`,
          color: nodeColors.Sector,
          shape: "ellipse",
        });
      }
    }

    if (byKind.Affiliation.length > 0) {
      if (colorAffiliationsBySector || shapeSectorsBySector) {
        const seen = new Set<string>();
        for (const n of byKind.Affiliation) {
          const sectorName = affiliationPrimarySector.get(n.id) ?? "Unassigned";
          if (seen.has(sectorName)) continue;
          seen.add(sectorName);
          const ss = sectorPalette[sectorName];
          entries.push({
            label: `Affiliation (${sectorName})`,
            color: ss?.color ?? nodeColors.Affiliation,
            shape: ss?.shape ?? "ellipse",
          });
        }
      } else {
        entries.push({
          label: `Affiliation (${byKind.Affiliation.length})`,
          color: nodeColors.Affiliation,
          shape: "ellipse",
        });
      }
    }

    return entries;
  }, [
    filtered,
    nodeColors,
    sectorPalette,
    colorAffiliationsBySector,
    shapeSectorsBySector,
    affiliationPrimarySector,
  ]);

  useEffect(() => {
    if (!cyHostRef.current || !filtered) return;
    if (cyRef.current) {
      cyRef.current.destroy();
    }
    const cy = cytoscape({
      container: cyHostRef.current,
      elements: [
        ...filtered.nodes.map((n) => ({
          data: {
            id: n.id,
            name: n.name,
            kind: n.kind,
            address: n.address,
            primarySector:
              n.kind === "Affiliation"
                ? affiliationPrimarySector.get(n.id) ?? null
                : null,
          },
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

    const host = cyHostRef.current;
    const ro = new ResizeObserver(() => {
      cy.resize();
    });
    ro.observe(host);

    cyRef.current = cy;
    return () => {
      ro.disconnect();
      cy.removeListener("dragfree", "node", onDragFree);
      cy.destroy();
      cyRef.current = null;
    };
  }, [filtered, styleSheet, layout, dynamicPhysics, affiliationPrimarySector]);

  const onExport = async () => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const scale = Math.max(1, exportDpi / 96);
    const bg = exportNoBackground ? undefined : graphBackground;

    const downloadDataUrl = (dataUrl: string, filename: string) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();
    };

    if (showNodeLegend && graphViewportRef.current) {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(graphViewportRef.current, {
        backgroundColor: exportNoBackground ? null : graphBackground,
        scale,
        useCORS: true,
      });
      const mime =
        exportFormat === "jpeg" ? "image/jpeg" : "image/png";
      const quality = exportFormat === "jpeg" ? 0.95 : undefined;
      const rasterDataUrl = canvas.toDataURL(mime, quality);

      if (exportFormat === "pdf") {
        const widthPx = canvas.width;
        const heightPx = canvas.height;
        const widthPt = (widthPx / exportDpi) * 72;
        const heightPt = (heightPx / exportDpi) * 72;
        const pdf = new jsPDF({
          orientation: widthPt >= heightPt ? "landscape" : "portrait",
          unit: "pt",
          format: [widthPt, heightPt],
        });
        pdf.addImage(rasterDataUrl, "PNG", 0, 0, widthPt, heightPt, undefined, "FAST");
        pdf.save("collabgraph.pdf");
        return;
      }

      if (exportFormat === "svg") {
        const w = canvas.width;
        const h = canvas.height;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${rasterDataUrl}" width="${w}" height="${h}"/></svg>`;
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "collabgraph.svg";
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      downloadDataUrl(rasterDataUrl, `collabgraph.${exportFormat}`);
      return;
    }

    if (exportFormat === "svg") {
      const svgApi = cy as cytoscape.Core & {
        svg: (options?: Record<string, unknown>) => string;
      };
      const svg = svgApi.svg({
        full: true,
        scale,
        bg,
      });
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "collabgraph.svg";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (exportFormat === "pdf") {
      const png = cy.png({
        full: true,
        bg,
        scale,
      });
      const widthPx = cy.width() * scale;
      const heightPx = cy.height() * scale;
      const widthPt = (widthPx / exportDpi) * 72;
      const heightPt = (heightPx / exportDpi) * 72;
      const pdf = new jsPDF({
        orientation: widthPt >= heightPt ? "landscape" : "portrait",
        unit: "pt",
        format: [widthPt, heightPt],
      });
      pdf.addImage(png, "PNG", 0, 0, widthPt, heightPt, undefined, "FAST");
      pdf.save("collabgraph.pdf");
      return;
    }

    if (exportFormat === "jpeg" && exportNoBackground) {
      onToast("info", "JPEG does not support transparency; using current background.");
    }
    const rasterBg =
      exportFormat === "jpeg" && exportNoBackground ? graphBackground : bg;
    const png = exportFormat === "jpeg"
      ? cy.jpg({ full: true, bg: rasterBg, scale })
      : cy.png({ full: true, bg: rasterBg, scale });
    downloadDataUrl(png, `collabgraph.${exportFormat}`);
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
    setGraphBackground("#0b1220");
    setSectorPalette({});
    setColorAffiliationsBySector(false);
    setShapeSectorsBySector(false);
    setShowNodeLegend(false);
  };

  const randomizeSectorPalette = () => {
    if (sectors.length === 0) {
      onToast("info", "No sectors loaded yet.");
      return;
    }
    const next: SectorPalette = {};
    const step = 360 / sectors.length;
    sectors.forEach((s, i) => {
      next[s] = {
        color: randomSectorColor(Math.floor((i * step) % 360)),
        shape: randomSectorShape(),
      };
    });
    setSectorPalette(next);
  };

  const updateSectorEntry = (
    sectorName: string,
    patch: Partial<SectorStyle>,
  ) => {
    setSectorPalette((prev) => {
      const current = prev[sectorName] ?? {
        color: randomSectorColor(),
        shape: "ellipse" as NodeShape,
      };
      return { ...prev, [sectorName]: { ...current, ...patch } };
    });
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
        graphBackground,
        sectorPalette,
        colorAffiliationsBySector,
        shapeSectorsBySector,
        showNodeLegend,
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
    setGraphBackground(saved.graphBackground);
    setSectorPalette(saved.sectorPalette ?? {});
    setColorAffiliationsBySector(saved.colorAffiliationsBySector);
    setShapeSectorsBySector(saved.shapeSectorsBySector);
    setShowNodeLegend(saved.showNodeLegend);
    onToast("success", "Saved graph styles loaded.");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
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
          <label>Dynamic force</label>
          <button
            onClick={() => setDynamicPhysics((v) => !v)}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {dynamicPhysics ? "Dynamic: on" : "Dynamic: off"}
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={reload} disabled={loading}>
            Refresh
          </button>
          <button
            className="primary"
            onClick={() => {
              void onExport();
            }}
            title="Export image"
          >
            Export {exportFormat.toUpperCase()}
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

      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: "relative",
        }}
      >
        <div
          ref={graphViewportRef}
          className="graph-viewport"
          style={{ background: graphBackground }}
        >
          <div ref={cyHostRef} className="cy-host" style={{ background: graphBackground }} />
          {showNodeLegend && legendEntries.length > 0 && (
            <div className="graph-overlay-legend" aria-label="Node legend">
              <h4>Visible node legend</h4>
              {legendEntries.map((entry) => (
                <div
                  key={`${entry.label}-${entry.shape}`}
                  className="graph-overlay-legend-row"
                >
                  <span
                    className="graph-overlay-legend-swatch"
                    style={{ background: entry.color }}
                    title={`shape: ${entry.shape}`}
                  />
                  <span className="graph-overlay-legend-text">{entry.label}</span>
                  <span className="graph-overlay-legend-shape">{entry.shape}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside
          className={`style-rail${showStylePanel ? " open" : ""}`}
          aria-label="Graph style settings"
        >
          <button
            className="style-rail-toggle"
            onClick={() => setShowStylePanel((v) => !v)}
            aria-expanded={showStylePanel}
            aria-label={showStylePanel ? "Collapse styles" : "Expand styles"}
            title={showStylePanel ? "Collapse styles" : "Expand styles"}
          >
            <span className="style-rail-caret" aria-hidden>
              {showStylePanel ? "›" : "‹"}
            </span>
            {!showStylePanel && (
              <span className="style-rail-label">Styles</span>
            )}
          </button>
          {showStylePanel && (
            <div className="style-rail-body">
              <div
                className="sidebar-tabs"
                role="tablist"
                aria-label="Sidebar sections"
              >
                <button
                  role="tab"
                  aria-selected={sidebarTab === "styles"}
                  className={sidebarTab === "styles" ? "active" : ""}
                  onClick={() => setSidebarTab("styles")}
                >
                  Styles
                </button>
                <button
                  role="tab"
                  aria-selected={sidebarTab === "export"}
                  className={sidebarTab === "export" ? "active" : ""}
                  onClick={() => setSidebarTab("export")}
                >
                  Export
                </button>
              </div>
              {sidebarTab === "styles" && (<>
              <section className="style-panel-section">
                <h4>Display</h4>
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
                  <label>Background</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="color"
                      value={graphBackground}
                      onChange={(e) => setGraphBackground(e.target.value)}
                      aria-label="Graph background color"
                    />
                    <button
                      onClick={() => setGraphBackground("#0b1220")}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => setGraphBackground("#ffffff")}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                    >
                      White
                    </button>
                  </div>
                </div>
                <div className="field">
                  <label>Node legend overlay</label>
                  <button
                    onClick={() => setShowNodeLegend((v) => !v)}
                    aria-pressed={showNodeLegend}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                  >
                    {showNodeLegend ? "On" : "Off"}
                  </button>
                </div>
              </section>

              <section className="style-panel-section">
                <h4>Nodes</h4>
                {(Object.keys(nodeColors) as NodeKind[]).map((k) => (
                  <div key={`node-style-${k}`} className="field">
                    <label>{k}</label>
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
              </section>

              <section className="style-panel-section">
                <h4>Relationships</h4>
                {RELATIONSHIP_TYPES.map((rel) => (
                  <div key={`edge-style-${rel}`} className="field">
                    <label>{rel}</label>
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
              </section>

              <section className="style-panel-section">
                <h4>By Sector</h4>
                <div className="field">
                  <label>Color affiliations + sectors</label>
                  <button
                    onClick={() => setColorAffiliationsBySector((v) => !v)}
                    aria-pressed={colorAffiliationsBySector}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                  >
                    {colorAffiliationsBySector ? "On" : "Off"}
                  </button>
                </div>
                <div className="field">
                  <label>Shape affiliations + sectors</label>
                  <button
                    onClick={() => setShapeSectorsBySector((v) => !v)}
                    aria-pressed={shapeSectorsBySector}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                  >
                    {shapeSectorsBySector ? "On" : "Off"}
                  </button>
                </div>
                <div className="field">
                  <button
                    onClick={randomizeSectorPalette}
                    style={{ fontSize: 12, padding: "5px 10px" }}
                  >
                    Randomize sector palette
                  </button>
                </div>
                {sectors.length > 0 && (
                  <div className="sector-palette-list">
                    {sectors.map((s) => {
                      const entry =
                        sectorPalette[s] ?? {
                          color: "#888888",
                          shape: "ellipse" as NodeShape,
                        };
                      return (
                        <div key={`sector-${s}`} className="sector-palette-row">
                          <span
                            className="sector-palette-name"
                            title={s}
                          >
                            {s}
                          </span>
                          <input
                            type="color"
                            value={entry.color}
                            onChange={(e) =>
                              updateSectorEntry(s, { color: e.target.value })
                            }
                            aria-label={`${s} color`}
                          />
                          <select
                            value={entry.shape}
                            onChange={(e) =>
                              updateSectorEntry(s, {
                                shape: e.target.value as NodeShape,
                              })
                            }
                            aria-label={`${s} shape`}
                            style={{ minWidth: 110 }}
                          >
                            {SECTOR_SHAPE_OPTIONS.map((sh) => (
                              <option key={sh} value={sh}>
                                {sh}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="style-panel-section">
                <h4>Typography</h4>
                <div className="field">
                  <label>Node label font</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={nodeLabelFontFamily}
                      onChange={(e) => setNodeLabelFontFamily(e.target.value)}
                      style={{ minWidth: 140 }}
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
                      onChange={(e) =>
                        setNodeLabelFontSize(Number(e.target.value) || 11)
                      }
                      style={{ width: 84, minWidth: 84 }}
                      aria-label="Node label font size"
                    />
                  </div>
                </div>
              </section>

              <section className="style-panel-section">
                <h4>Presets</h4>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={saveStyles}>Save styles</button>
                  <button onClick={loadStyles}>Load styles</button>
                  <button onClick={resetStyles}>Reset styles</button>
                </div>
              </section>
              </>)}
              {sidebarTab === "export" && (
                <section className="style-panel-section">
                  <h4>Image export</h4>
                  <div className="field">
                    <label>File type</label>
                    <select
                      value={exportFormat}
                      onChange={(e) =>
                        setExportFormat(e.target.value as ExportFormat)
                      }
                      aria-label="Export file type"
                    >
                      <option value="png">PNG</option>
                      <option value="jpeg">JPEG</option>
                      <option value="svg">SVG</option>
                      <option value="pdf">PDF</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>DPI</label>
                    <div
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <input
                        type="number"
                        min={72}
                        max={1200}
                        step={10}
                        value={exportDpi}
                        onChange={(e) =>
                          setExportDpi(Number(e.target.value) || 300)
                        }
                        aria-label="Export DPI"
                        style={{ width: 96, minWidth: 96 }}
                      />
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {[72, 150, 300, 600].map((dpi) => (
                          <button
                            key={dpi}
                            onClick={() => setExportDpi(dpi)}
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            className={exportDpi === dpi ? "primary" : ""}
                          >
                            {dpi}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Background</label>
                    <button
                      onClick={() => setExportNoBackground((v) => !v)}
                      style={{ fontSize: 12, padding: "5px 10px" }}
                      title="Transparent / no background export"
                    >
                      {exportNoBackground
                        ? "No background: on"
                        : "No background: off"}
                    </button>
                    {exportNoBackground && exportFormat === "jpeg" && (
                      <span
                        className="muted"
                        style={{ marginTop: 4, fontSize: 11 }}
                      >
                        JPEG cannot be transparent; the current background color
                        will be used.
                      </span>
                    )}
                  </div>
                  <div className="field">
                    <button
                      className="primary"
                      onClick={() => {
                        void onExport();
                      }}
                      style={{ fontSize: 13 }}
                    >
                      Export {exportFormat.toUpperCase()}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
