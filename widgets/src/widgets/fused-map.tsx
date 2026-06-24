// widgets/fused-map.tsx — the rich multi-layer map. A SUBSET of the application's
// fused-map (same prop/layer keys), rendered with deck.gl on a no-token MapLibre
// basemap (Mapbox→MapLibre; the Mapbox `basemap` style URL is mapped to a no-token
// equivalent by name). Layer types: scatterplot / geojson / deck-geojson / h3 /
// heatmap / arc (deck.gl) and mvt / raster (native MapLibre tiles); per-layer `style`
// is static or data-driven (continuous/categorical color via named palettes). Chrome:
// layer panel, basemap switcher, color legend, scale + nav controls.
//
// Data binds via each layer's `sql` (the planner synthesizes one query per sql layer
// and stamps _queryId/_sql) or inline `data`. Thin + node-importable; the heavy deck.gl
// renderer lives in ../maps/* (dynamic import); the deployed bundle aliases this module
// to ./_map-placeholder (build.mjs).
import { z } from "zod";
import { defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { FusedMapRenderer } from "../maps/fused-map-renderer";
import type { FusedLayerDef } from "../maps/fused-deck-layers";

const styleSchema = z
  .object({
    fillColor: z.unknown().optional().describe('[r,g,b], CSS string, or data-driven {type:"continuous"|"categorical", attr, domain, palette}.'),
    lineColor: z.unknown().optional().describe("Stroke color (same forms as fillColor)."),
    lineWidth: z.number().optional().describe("Stroke width in px."),
    opacity: z.number().optional().describe("Layer opacity 0–1."),
    pointRadius: z.number().optional().describe("Circle radius (px) for point features."),
    coverage: z.number().optional().describe("H3 hex coverage 0–1."),
    extruded: z.boolean().optional().describe("3D extrusion (h3, deck-geojson)."),
    elevationAttr: z.string().optional().describe("Feature property for extrusion height."),
    elevationScale: z.number().optional().describe("Multiplier for extrusion height."),
  })
  .optional();

const layerSchema = z.object({
  id: z.string().describe("Unique layer identifier."),
  name: z.string().optional().describe("Display name (layer panel / legend)."),
  type: z
    .enum(["mvt", "raster", "geojson", "h3", "heatmap", "arc", "scatterplot", "deck-geojson"])
    .describe("Layer type."),
  visible: z.boolean().optional().describe("Initial visibility (default true)."),
  tileUrl: z.string().optional().describe("Tile URL template {x}/{y}/{z} (mvt, raster)."),
  minZoom: z.number().optional(),
  maxZoom: z.number().optional(),
  zoomOffset: z.number().optional(),
  maxRequests: z.number().optional(),
  sourceLayer: z.string().optional().describe("MVT source layer (default 'default')."),
  data: z.unknown().optional().describe("Inline GeoJSON FeatureCollection (geojson type)."),
  sql: z.string().optional().describe("DuckDB SQL with {{udf}} / $param; rows → GeoJSON for rendering."),
  geometryColumn: z.string().optional().describe("GeoJSON-string geometry column (default 'geometry')."),
  h3Column: z.string().optional().describe("H3 hex index column (h3 layer)."),
  latColumn: z.string().optional().describe("Latitude column (point data, default 'lat')."),
  lngColumn: z.string().optional().describe("Longitude column (point data, default 'lng')."),
  tooltip: z.union([z.boolean(), z.array(z.string())]).optional().describe("Hover tooltip: true = all props, string[] = specific."),
  legend: z.union([z.boolean(), z.object({ title: z.string().optional() })]).optional().describe("Color legend for data-driven color."),
  style: styleSchema,
});

export const fusedMapProps = z
  .object({
    basemap: z.string().optional().describe('Basemap (a Mapbox style URL is mapped to a no-token equivalent by name; default "dark").'),
    centerLng: z.number().optional().describe("Initial center longitude (default -98)."),
    centerLat: z.number().optional().describe("Initial center latitude (default 39.5)."),
    zoom: z.number().optional().describe("Initial zoom (default 4)."),
    minZoom: z.number().optional(),
    maxZoom: z.number().optional(),
    layers: z.array(layerSchema).optional().describe("Map layers (mvt/raster/geojson/h3/heatmap/arc/scatterplot/deck-geojson)."),
    showControls: z.boolean().optional().describe("Zoom/nav controls (default true)."),
    showScale: z.boolean().optional().describe("Scale bar (default true)."),
    showBasemapSwitcher: z.boolean().optional().describe("Dark/light/satellite toggle (default true)."),
    showLegend: z.boolean().optional().describe("Color legend for data-driven layers (default true)."),
    showLayerPanel: z.boolean().optional().describe("Layer visibility panel (default true)."),
    param: z.string().optional().describe('Canvas param for the viewport bounds ("w,s,e,n" string).'),
    autoSend: z.boolean().optional().describe("Emit bounds on pan/zoom (default false)."),
    autoSendDebounceMs: z.number().optional().describe("Debounce ms for autoSend (default 600)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type FusedMapProps = z.infer<typeof fusedMapProps>;

function FusedMap({ element }: ComponentRenderProps<FusedMapProps>) {
  const p = element.props;
  const rawLayers = (p.layers ?? []) as unknown[];
  const layers: FusedLayerDef[] = rawLayers
    .map((l) => (typeof l === "object" && l !== null ? (l as FusedLayerDef) : null))
    .filter((l): l is FusedLayerDef => l !== null && typeof l.id === "string" && typeof l.type === "string");

  return (
    <FusedMapRenderer
      basemap={p.basemap}
      centerLng={p.centerLng ?? -98}
      centerLat={p.centerLat ?? 39.5}
      zoom={p.zoom ?? 4}
      minZoom={p.minZoom}
      maxZoom={p.maxZoom}
      layers={layers}
      showControls={p.showControls ?? true}
      showScale={p.showScale ?? true}
      showBasemapSwitcher={p.showBasemapSwitcher ?? true}
      showLegend={p.showLegend ?? true}
      showLayerPanel={p.showLayerPanel ?? true}
      param={p.param}
      autoSend={p.autoSend ?? false}
      autoSendDebounceMs={p.autoSendDebounceMs ?? 600}
      style={(p as { style?: string }).style}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: FusedMap,
    props: fusedMapProps,
    description:
      "Rich multi-layer map (deck.gl on a no-token MapLibre basemap): scatterplot/geojson/h3/heatmap/arc + mvt/raster layers, data-driven color (continuous/categorical palettes), tooltips, legend, layer panel, basemap switcher. A subset of the application's fused-map. WHEN TO USE: reach for this over `map` when you need the advanced deck.gl renderers (large point clouds, H3/hexbin, heatmap, arc), vector/raster TILE layers, data-driven color scales with a legend, or an interactive layer panel / basemap switcher. For simply drawing a few GeoJSON geometry layers from a UDF, the lighter `map` is enough. Use `map-bounds` if you only need to capture the viewport as an input param (no data display).",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
