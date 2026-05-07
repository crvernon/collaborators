/**
 * Legend foreground colors from background hex (WCAG-style luminance / contrast).
 */

export type LegendTone = {
  /** Primary row labels */
  text: string;
  /** Section heading */
  muted: string;
  /** Shape glyph outline */
  glyphStroke: string;
  /** Panel border blended with tone */
  border: string;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(lumA: number, lumB: number): number {
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_TEXT_RGB = { r: 15, g: 23, b: 42 }; // ~ slate-900
const LIGHT_TEXT_RGB = { r: 248, g: 250, b: 252 }; // ~ slate-50

/** Readable legend chrome from a #RRGGBB (or #RGB) background */
export function legendToneFromBackground(backgroundHex: string): LegendTone {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) {
    return {
      text: "#f1f5f9",
      muted: "#94a3b8",
      glyphStroke: "rgba(255, 255, 255, 0.45)",
      border: "rgba(255, 255, 255, 0.22)",
    };
  }

  const bgL = relativeLuminance(rgb);
  const darkLum = relativeLuminance(DARK_TEXT_RGB);
  const lightLum = relativeLuminance(LIGHT_TEXT_RGB);
  const contrastDark = contrastRatio(bgL, darkLum);
  const contrastLight = contrastRatio(bgL, lightLum);

  const useLightForeground = contrastLight >= contrastDark;

  if (useLightForeground) {
    return {
      text: "#f1f5f9",
      muted: "#cbd5e1",
      glyphStroke: "rgba(255, 255, 255, 0.45)",
      border: "rgba(255, 255, 255, 0.22)",
    };
  }

  return {
    text: "#0f172a",
    muted: "#475569",
    glyphStroke: "rgba(15, 23, 42, 0.42)",
    border: "rgba(15, 23, 42, 0.22)",
  };
}
