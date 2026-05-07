import type { NodeKind } from "./api";

export const NODE_COLORS: Record<NodeKind, string> = {
  Collaborator: "#4C9AFF",
  Sector: "#FF8B00",
  Affiliation: "#36B37E",
};

export const NODE_SIZES: Record<NodeKind, number> = {
  Collaborator: 32,
  Sector: 44,
  Affiliation: 58,
};
