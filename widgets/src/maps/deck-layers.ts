// maps/deck-layers.ts — build a deck.gl layer from a map layer's rows + vizConfig.
//
// Mirrors the application's udf-map architecture: deck.gl renders the DATA (as a
// GeoJsonLayer), MapLibre is the basemap underneath (a no-token swap for Mapbox).
// deck.gl is loaded dynamically by the renderer and its classes are passed in here
// (so this module — and the widget that imports it — stays node-importable by the
// schema generator).
//
// vizConfig is a documented SUBSET of the application's viz config. Static styling:
//   fillColor, lineColor (CSS/hex), lineWidth, pointRadius, opacity, stroked, filled,
//   geometryColumn (default "geometry"), latColumn/lngColumn (build points from lat/lng
//   when there is no geometry column).
// DATA-DRIVEN styling (the part a uniform renderer can't do):
//   radiusColumn (+ radiusRange [minPx,maxPx], radiusDomain [min,max]) → size points by a column;
//   colorColumn  (+ colorRange [css,…], colorDomain [min,max])         → color by a column.

interface Geometry {
  type: string;
  coordinates?: unknown;
}
interface Feature {
  type: "Feature";
  geometry: Geometry;
  properties: Record<string, unknown>;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

/** Minimal constructor type for a deck.gl layer class (avoids an `any` + a static dep). */
export type DeckLayerClass = new (props: Record<string, unknown>) => unknown;
export interface DeckClasses {
  GeoJsonLayer: DeckLayerClass;
}

type RGBA = [number, number, number, number];

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [239, 68, 68],
  orange: [249, 115, 22],
  amber: [251, 191, 36],
  yellow: [232, 255, 89],
  green: [74, 222, 128],
  blue: [96, 165, 250],
};

/** Parse a CSS color (#rgb, #rrggbb, rgb(), or a few names) to an [r,g,b,a] 0–255 array. */
function toRGBA(color: unknown, alpha = 255): RGBA {
  if (Array.isArray(color) && typeof color[0] === "number") {
    const [r, g, b, a] = color as number[];
    return [r ?? 0, g ?? 0, b ?? 0, a ?? alpha];
  }
  if (typeof color === "string") {
    const s = color.trim().toLowerCase();
    if (NAMED[s]) return [...NAMED[s], alpha];
    const hex = s.replace("#", "");
    if (/^[0-9a-f]{3}$/.test(hex)) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b, alpha];
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        alpha,
      ];
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map((x) => parseFloat(x));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] != null ? parts[3] * 255 : alpha];
    }
  }
  return [232, 255, 89, alpha]; // default lime
}

function num(viz: Record<string, unknown>, key: string, fallback: number): number {
  return typeof viz[key] === "number" ? (viz[key] as number) : fallback;
}
function str(viz: Record<string, unknown>, key: string): string | undefined {
  return typeof viz[key] === "string" ? (viz[key] as string) : undefined;
}

function toFeatureCollection(
  rows: ReadonlyArray<Record<string, unknown>>,
  viz: Record<string, unknown>,
): FeatureCollection {
  const geometryColumn = str(viz, "geometryColumn") ?? "geometry";
  const latColumn = str(viz, "latColumn");
  const lngColumn = str(viz, "lngColumn");
  const features: Feature[] = [];
  for (const row of rows) {
    let geometry: Geometry | undefined;
    const raw = row[geometryColumn];
    if (raw != null) {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") {
          const obj = parsed as { type?: string; geometry?: Geometry };
          geometry = obj.type === "Feature" ? obj.geometry : (obj as Geometry);
        }
      } catch {
        geometry = undefined;
      }
    }
    // Fall back to lat/lng columns → a Point (matches the app's point layers).
    if ((!geometry || typeof geometry.type !== "string") && latColumn && lngColumn) {
      const lat = Number(row[latColumn]);
      const lng = Number(row[lngColumn]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        geometry = { type: "Point", coordinates: [lng, lat] };
      }
    }
    if (!geometry || typeof geometry.type !== "string") continue;
    features.push({ type: "Feature", geometry, properties: { ...row } });
  }
  return { type: "FeatureCollection", features };
}

/** Linear domain [min,max] of a numeric column across features (for data-driven scales). */
function domainOf(
  features: Feature[],
  column: string,
  override: unknown,
): [number, number] {
  if (Array.isArray(override) && override.length === 2) {
    return [Number(override[0]), Number(override[1])];
  }
  let min = Infinity;
  let max = -Infinity;
  for (const f of features) {
    const v = Number(f.properties[column]);
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [0, max > 0 ? max : 1];
  return [min, max];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Build a deck.gl GeoJsonLayer for one map layer. Returns a deck layer instance
 * (typed `unknown` — the caller hands it to MapboxOverlay.setProps).
 */
export function buildDeckLayer(
  deck: DeckClasses,
  id: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  vizConfig: Record<string, unknown> | undefined,
): unknown {
  const viz = vizConfig ?? {};
  const fc = toFeatureCollection(rows, viz);
  const opacity = num(viz, "opacity", 0.8);
  const lineWidth = num(viz, "lineWidth", 1);
  const pointRadius = num(viz, "pointRadius", 5);
  const baseFill = toRGBA(viz.fillColor ?? "#E8FF59", Math.round(opacity * 255));
  const baseLine = toRGBA(viz.lineColor ?? viz.fillColor ?? "#E8FF59");

  // Data-driven size: radiusColumn → linear scale into radiusRange (px).
  const radiusColumn = str(viz, "radiusColumn");
  const radiusRange = (Array.isArray(viz.radiusRange) ? viz.radiusRange : [3, 28]) as number[];
  const radiusDomain = radiusColumn
    ? domainOf(fc.features, radiusColumn, viz.radiusDomain)
    : null;

  // Data-driven color: colorColumn → interpolate across colorRange.
  const colorColumn = str(viz, "colorColumn");
  const colorRange = (Array.isArray(viz.colorRange) ? viz.colorRange : []) as unknown[];
  const colorStops = colorRange.map((c) => toRGBA(c, Math.round(opacity * 255)));
  const colorDomain = colorColumn ? domainOf(fc.features, colorColumn, viz.colorDomain) : null;

  const getPointRadius =
    radiusColumn && radiusDomain
      ? (f: Feature) => {
          const v = Number(f.properties[radiusColumn]);
          const t = (v - radiusDomain[0]) / (radiusDomain[1] - radiusDomain[0] || 1);
          return lerp(radiusRange[0] ?? 3, radiusRange[1] ?? 28, Math.sqrt(Math.max(0, t)));
        }
      : pointRadius;

  const getFillColor =
    colorColumn && colorDomain && colorStops.length >= 2
      ? (f: Feature): RGBA => {
          const v = Number(f.properties[colorColumn]);
          const t = (v - colorDomain[0]) / (colorDomain[1] - colorDomain[0] || 1);
          const pos = Math.max(0, Math.min(1, t)) * (colorStops.length - 1);
          const i = Math.floor(pos);
          const j = Math.min(colorStops.length - 1, i + 1);
          const frac = pos - i;
          const a = colorStops[i];
          const b = colorStops[j];
          return [
            Math.round(lerp(a[0], b[0], frac)),
            Math.round(lerp(a[1], b[1], frac)),
            Math.round(lerp(a[2], b[2], frac)),
            a[3],
          ];
        }
      : baseFill;

  return new deck.GeoJsonLayer({
    id: `ofw-deck-${id}`,
    data: fc,
    pickable: true,
    stroked: viz.stroked !== false,
    filled: viz.filled !== false,
    pointType: "circle",
    pointRadiusUnits: "pixels",
    pointRadiusMinPixels: 1,
    lineWidthUnits: "pixels",
    getFillColor,
    getLineColor: baseLine,
    getLineWidth: lineWidth,
    getPointRadius,
    updateTriggers: {
      getFillColor: [colorColumn, colorRange.length, opacity],
      getPointRadius: [radiusColumn, radiusRange.join()],
    },
  });
}
