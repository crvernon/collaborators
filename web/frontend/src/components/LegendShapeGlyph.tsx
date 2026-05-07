/** Small SVG glyphs matching cytoscape.js node shapes used in the graph legend. */

import type { ReactNode } from "react";

const VB = 24;
const CX = 12;
const CY = 12;

function regularPolygonPoints(
  sides: number,
  cx: number,
  cy: number,
  r: number,
  rotation = -Math.PI / 2,
): string {
  return Array.from({ length: sides }, (_, i) => {
    const a = rotation + (i * 2 * Math.PI) / sides;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
}

function starPolygonPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
): string {
  const step = Math.PI / points;
  const verts: string[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    verts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return verts.join(" ");
}

type Props = {
  shape: string;
  color: string;
  /** Rendered width/height in CSS px */
  size?: number;
  /** Outline around filled shape (legibility on any legend background) */
  outlineStroke?: string;
};

export function LegendShapeGlyph({
  shape,
  color,
  size = 18,
  outlineStroke = "rgba(255, 255, 255, 0.45)",
}: Props) {
  const stroke = outlineStroke;
  const sw = 1.25;
  const common = {
    fill: color,
    stroke,
    strokeWidth: sw,
    vectorEffect: "non-scaling-stroke" as const,
  };

  let inner: ReactNode;
  switch (shape) {
    case "rectangle":
      inner = <rect x="4" y="6" width="16" height="12" {...common} />;
      break;
    case "round-rectangle":
      inner = (
        <rect x="4" y="6" width="16" height="12" rx="3.5" ry="3.5" {...common} />
      );
      break;
    case "triangle":
    case "round-triangle":
      inner = (
        <polygon points={regularPolygonPoints(3, CX, CY, 10.5)} {...common} />
      );
      break;
    case "diamond":
      inner = (
        <polygon
          points={regularPolygonPoints(4, CX, CY, 10, -Math.PI / 4)}
          {...common}
        />
      );
      break;
    case "pentagon":
    case "round-pentagon":
      inner = (
        <polygon points={regularPolygonPoints(5, CX, CY, 9.5)} {...common} />
      );
      break;
    case "hexagon":
    case "round-hexagon":
      inner = (
        <polygon points={regularPolygonPoints(6, CX, CY, 9.5)} {...common} />
      );
      break;
    case "heptagon":
      inner = (
        <polygon points={regularPolygonPoints(7, CX, CY, 9)} {...common} />
      );
      break;
    case "octagon":
      inner = (
        <polygon points={regularPolygonPoints(8, CX, CY, 9)} {...common} />
      );
      break;
    case "star":
      inner = (
        <polygon
          points={starPolygonPoints(CX, CY, 10, 4.2, 5)}
          {...common}
        />
      );
      break;
    case "vee":
      inner = <polygon points="12,4 19.5,18 12,12.5 4.5,18" {...common} />;
      break;
    case "ellipse":
    default:
      inner = (
        <ellipse cx={CX} cy={CY} rx="10" ry="7" {...common} />
      );
      break;
  }

  return (
    <svg
      className="graph-overlay-legend-shape-glyph"
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      aria-hidden
    >
      {inner}
    </svg>
  );
}
