// maps/palettes.ts — named color palettes for data-driven map styling, mirroring the
// CARTO/d3 palette names the application's fused-map accepts (Sunset, Viridis, …).
// Used by the continuous/categorical color ramps in fused-deck-layers.ts.

export type RGB = [number, number, number];

const PALETTES: Record<string, string[]> = {
  Sunset: ["#f3e79b", "#fac484", "#f8a07e", "#eb7f86", "#ce6693", "#a059a0", "#5c53a5"],
  SunsetDark: ["#fcde9c", "#faa476", "#f0746e", "#e34f6f", "#dc3977", "#b9257a", "#7c1d6f"],
  Viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  Magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  Plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  Teal: ["#d1eeea", "#a8dbd9", "#85c4c9", "#68abb8", "#4f90a6", "#3b738f", "#2a5674"],
  BluYl: ["#f7feae", "#b7e6a5", "#7ccba2", "#46aea0", "#089099", "#00718b", "#045275"],
  Purp: ["#f3e0f7", "#e4c7f1", "#d1afe8", "#b998dd", "#9f82ce", "#826dba", "#63589f"],
  OrYel: ["#ecda9a", "#efc47e", "#f3ad6a", "#f7945d", "#f97b57", "#f66356", "#ee4d5a"],
  Mint: ["#e4f1e1", "#b4d9cc", "#89c0b6", "#63a6a0", "#448c8a", "#287274", "#0d585f"],
};

function hexToRgb(hex: string): RGB {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** Resolve a palette name to its RGB stops (falls back to Sunset). */
export function paletteStops(name: string | undefined): RGB[] {
  const stops = PALETTES[name ?? ""] ?? PALETTES.Sunset;
  return stops.map(hexToRgb);
}

/** Sample a continuous ramp at t∈[0,1] (linear interpolation between stops). */
export function sampleRamp(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const j = Math.min(stops.length - 1, i + 1);
  const f = x - i;
  const a = stops[i];
  const b = stops[j];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** The hex stops for a palette (for rendering a legend gradient). */
export function paletteHex(name: string | undefined): string[] {
  return PALETTES[name ?? ""] ?? PALETTES.Sunset;
}
