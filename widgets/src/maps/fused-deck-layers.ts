// maps/fused-deck-layers.ts — build a deck.gl layer from a fused-map LayerDef.
//
// Mirrors the application's fused-map layer model: type dispatch (scatterplot /
// geojson / deck-geojson / h3 / heatmap / arc) + a per-layer `style` that is static
// ([r,g,b] / CSS) OR data-driven ({type:"continuous"|"categorical", attr, domain,
// palette}). deck.gl classes are passed in (the renderer loads deck dynamically).
import { paletteStops, sampleRamp, type RGB } from "./palettes";

export type DeckLayerClass = new (props: Record<string, unknown>) => unknown;
export interface FusedDeckClasses {
  ScatterplotLayer: DeckLayerClass;
  GeoJsonLayer: DeckLayerClass;
  H3HexagonLayer: DeckLayerClass;
  HeatmapLayer: DeckLayerClass;
  ArcLayer: DeckLayerClass;
}

export interface LayerStyle {
  fillColor?: unknown;
  lineColor?: unknown;
  lineWidth?: number;
  opacity?: number;
  pointRadius?: number;
  coverage?: number;
  extruded?: boolean;
  elevationAttr?: string;
  elevationScale?: number;
}
export interface FusedLayerDef {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  sql?: string;
  data?: unknown;
  geometryColumn?: string;
  h3Column?: string;
  latColumn?: string;
  lngColumn?: string;
  tooltip?: boolean | string[];
  legend?: boolean | { title?: string };
  style?: LayerStyle;
  // tiled layers (mvt / raster):
  tileUrl?: string;
  sourceLayer?: string;
  minZoom?: number;
  maxZoom?: number;
  zoomOffset?: number;
  maxRequests?: number;
  // stamped by the planner for sql layers:
  _queryId?: string;
  _sql?: string;
}

type RGBA = [number, number, number, number];
type Row = Record<string, unknown>;
type ColorOut = RGBA | ((d: unknown) => RGBA);

const NAMED: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [239, 68, 68],
  orange: [249, 115, 22],
  yellow: [232, 255, 89],
  green: [74, 222, 128],
  blue: [96, 165, 250],
  gray: [148, 163, 184],
};

function toRgb(c: unknown, fallback: RGB): RGB {
  if (Array.isArray(c) && typeof c[0] === "number") return [c[0], c[1], c[2]];
  if (typeof c === "string") {
    const s = c.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s];
    const h = s.replace("#", "");
    if (/^[0-9a-f]{6}$/.test(h)) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    if (/^[0-9a-f]{3}$/.test(h)) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
  }
  return fallback;
}

interface ColorSpec {
  type?: string;
  attr?: string;
  domain?: number[];
  palette?: string;
  values?: unknown[];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Resolve a style color (static or data-driven) to a deck color value/accessor. */
function makeColor(spec: unknown, read: (d: unknown) => Row, alpha: number, fallback: RGB): ColorOut {
  if (spec && typeof spec === "object" && !Array.isArray(spec) && (spec as ColorSpec).type) {
    const c = spec as ColorSpec;
    const stops = paletteStops(c.palette);
    if (c.type === "continuous" && c.attr) {
      const dom = Array.isArray(c.domain) && c.domain.length === 2 ? c.domain : [0, 1];
      const min = Number(dom[0]);
      const max = Number(dom[1]);
      const attr = c.attr;
      return (d: unknown): RGBA => {
        const v = Number(read(d)[attr]);
        const t = (v - min) / (max - min || 1);
        const [r, g, b] = sampleRamp(stops, t);
        return [r, g, b, alpha];
      };
    }
    if (c.type === "categorical" && c.attr) {
      const attr = c.attr;
      const vals = (c.values as unknown[]) || [];
      return (d: unknown): RGBA => {
        const v = read(d)[attr];
        const i = vals.indexOf(v);
        const idx = (i >= 0 ? i : Math.abs(hash(String(v)))) % stops.length;
        const [r, g, b] = stops[idx];
        return [r, g, b, alpha];
      };
    }
  }
  const [r, g, b] = toRgb(spec, fallback);
  return [r, g, b, alpha];
}

interface Geometry {
  type: string;
  coordinates?: unknown;
}
function toFeatureCollection(rows: ReadonlyArray<Row>, layer: FusedLayerDef) {
  const geometryColumn = layer.geometryColumn ?? "geometry";
  const latColumn = layer.latColumn ?? "lat";
  const lngColumn = layer.lngColumn ?? "lng";
  const features = [];
  for (const row of rows) {
    let geometry: Geometry | undefined;
    const raw = row[geometryColumn];
    if (raw != null) {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") {
          const o = parsed as { type?: string; geometry?: Geometry };
          geometry = o.type === "Feature" ? o.geometry : (o as Geometry);
        }
      } catch {
        geometry = undefined;
      }
    }
    if (!geometry || typeof geometry.type !== "string") {
      const lat = Number(row[latColumn]);
      const lng = Number(row[lngColumn]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) geometry = { type: "Point", coordinates: [lng, lat] };
    }
    if (!geometry || typeof geometry.type !== "string") continue;
    features.push({ type: "Feature" as const, geometry, properties: { ...row } });
  }
  return { type: "FeatureCollection" as const, features };
}

const asRow = (d: unknown): Row => (d ?? {}) as Row;
const featProps = (d: unknown): Row => ((d as { properties?: Row })?.properties ?? {}) as Row;

/** Build a deck.gl layer for a fused-map LayerDef + its rows. Returns null if unbuildable. */
export function buildFusedLayer(
  deck: FusedDeckClasses,
  layer: FusedLayerDef,
  rows: ReadonlyArray<Row>,
): unknown {
  const style = layer.style ?? {};
  const opacity = typeof style.opacity === "number" ? style.opacity : 0.85;
  const alpha = Math.round(opacity * 255);
  const lineWidth = typeof style.lineWidth === "number" ? style.lineWidth : 1;
  const pointRadius = typeof style.pointRadius === "number" ? style.pointRadius : 6;
  const latColumn = layer.latColumn ?? "lat";
  const lngColumn = layer.lngColumn ?? "lng";
  const id = `ofw-fused-${layer.id}`;

  switch (layer.type) {
    case "scatterplot": {
      const getFillColor = makeColor(style.fillColor, asRow, alpha, [232, 255, 89]);
      const getLineColor = makeColor(style.lineColor, asRow, 255, [15, 15, 15]);
      return new deck.ScatterplotLayer({
        id,
        data: rows as Row[],
        pickable: true,
        stroked: lineWidth > 0,
        filled: true,
        radiusUnits: "pixels",
        radiusMinPixels: 1,
        lineWidthUnits: "pixels",
        getPosition: (d: unknown) => [Number(asRow(d)[lngColumn]), Number(asRow(d)[latColumn])],
        getRadius: pointRadius,
        getFillColor,
        getLineColor,
        getLineWidth: lineWidth,
        updateTriggers: { getFillColor: [JSON.stringify(style.fillColor), alpha] },
      });
    }
    case "h3": {
      const h3Column = layer.h3Column ?? "hex";
      const getFillColor = makeColor(style.fillColor, asRow, alpha, [99, 110, 250]);
      const elevationAttr = style.elevationAttr;
      return new deck.H3HexagonLayer({
        id,
        data: rows as Row[],
        pickable: true,
        filled: true,
        extruded: !!style.extruded,
        coverage: typeof style.coverage === "number" ? style.coverage : 0.9,
        elevationScale: typeof style.elevationScale === "number" ? style.elevationScale : 1,
        getHexagon: (d: unknown) => String(asRow(d)[h3Column]),
        getFillColor,
        getElevation: elevationAttr ? (d: unknown) => Number(asRow(d)[elevationAttr]) || 0 : 0,
        updateTriggers: { getFillColor: [JSON.stringify(style.fillColor), alpha] },
      });
    }
    case "heatmap": {
      const spec = style.fillColor as ColorSpec | undefined;
      const weightAttr = spec && spec.attr ? spec.attr : undefined;
      const stops = paletteStops(spec?.palette);
      return new deck.HeatmapLayer({
        id,
        data: rows as Row[],
        getPosition: (d: unknown) => [Number(asRow(d)[lngColumn]), Number(asRow(d)[latColumn])],
        getWeight: weightAttr ? (d: unknown) => Number(asRow(d)[weightAttr]) || 0 : 1,
        radiusPixels: pointRadius * 6,
        colorRange: stops.map(([r, g, b]) => [r, g, b]),
      });
    }
    case "arc": {
      const getSourceColor = makeColor(style.lineColor, asRow, alpha, [96, 165, 250]);
      const getTargetColor = makeColor(style.fillColor, asRow, alpha, [249, 115, 22]);
      return new deck.ArcLayer({
        id,
        data: rows as Row[],
        pickable: true,
        getWidth: lineWidth,
        getSourcePosition: (d: unknown) => [Number(asRow(d).sourceLng), Number(asRow(d).sourceLat)],
        getTargetPosition: (d: unknown) => [Number(asRow(d).targetLng), Number(asRow(d).targetLat)],
        getSourceColor,
        getTargetColor,
      });
    }
    // geojson / deck-geojson (and any unknown vector type) → GeoJsonLayer.
    default: {
      const fc = toFeatureCollection(rows, layer);
      const getFillColor = makeColor(style.fillColor, featProps, alpha, [232, 255, 89]);
      const getLineColor = makeColor(style.lineColor, featProps, 255, [232, 255, 89]);
      return new deck.GeoJsonLayer({
        id,
        data: fc,
        pickable: true,
        stroked: lineWidth > 0,
        filled: true,
        extruded: !!style.extruded,
        pointType: "circle",
        pointRadiusUnits: "pixels",
        pointRadiusMinPixels: 1,
        lineWidthUnits: "pixels",
        getFillColor,
        getLineColor,
        getLineWidth: lineWidth,
        getPointRadius: pointRadius,
        getElevation: style.elevationAttr
          ? (d: unknown) => Number(featProps(d)[style.elevationAttr as string]) || 0
          : 0,
        elevationScale: typeof style.elevationScale === "number" ? style.elevationScale : 1,
        updateTriggers: { getFillColor: [JSON.stringify(style.fillColor), alpha] },
      });
    }
  }
}
