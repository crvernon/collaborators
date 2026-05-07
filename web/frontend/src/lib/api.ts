import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export type NodeKind = "Collaborator" | "Sector" | "Affiliation";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  crs?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  rel: "AFFILIATED_WITH" | "WORKS_IN" | "PRESENT_AT";
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AffiliationGeo {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  crs: string | null;
  collaborators: string[];
  sectors: string[];
}

export interface VirtualLink {
  source: { name: string; latitude: number | null; longitude: number | null };
  target: { name: string; latitude: number | null; longitude: number | null };
  sectors: string[];
}

export interface HealthStatus {
  connected: boolean;
  db_path: string;
  error: string | null;
}

export interface GraphStats {
  collaborators: number;
  sectors: number;
  affiliations: number;
  relationships: number;
}

export const fetchHealth = () => api.get<HealthStatus>("/health").then((r) => r.data);
export const fetchSettings = () =>
  api.get<{ db_path: string }>("/settings").then((r) => r.data);
export const fetchStats = () => api.get<GraphStats>("/stats").then((r) => r.data);
export const fetchGraph = () => api.get<GraphPayload>("/graph").then((r) => r.data);
export const fetchAffiliations = () =>
  api.get<AffiliationGeo[]>("/affiliations").then((r) => r.data);
export const fetchAffiliationLinks = () =>
  api.get<VirtualLink[]>("/affiliations/links").then((r) => r.data);
export const fetchValues = (column: "sector" | "affiliation") =>
  api.get<string[]>(`/values/${column}`).then((r) => r.data);

export const initSchema = () => api.post<{ status: string }>("/init-schema").then((r) => r.data);
export const clearGraph = () => api.post<{ status: string }>("/clear").then((r) => r.data);

function appendColumnMapJson(
  fd: FormData,
  columnMap: Record<string, string> | undefined,
) {
  if (!columnMap) return;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(columnMap)) {
    const t = String(v).trim();
    if (t) cleaned[k] = t;
  }
  if (Object.keys(cleaned).length > 0) {
    fd.append("column_map_json", JSON.stringify(cleaned));
  }
}

export const fetchExcelSheets = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return api
    .post<{ sheets: string[] }>("/excel-sheets", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data.sheets);
};

export const fetchExcelColumns = (file: File, sheet = "collaborators") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("sheet", sheet);
  return api
    .post<{ columns: string[] }>("/excel-columns", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data.columns);
};

export const ingestUpload = (
  file: File,
  sheet = "collaborators",
  columnMap?: Record<string, string>,
) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("sheet", sheet);
  appendColumnMapJson(fd, columnMap);
  return api
    .post<{ rows: number; stats: GraphStats }>("/ingest", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
