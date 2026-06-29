// widgets/map.tsx — interactive map of one or more UDF layers. A strict SUBSET of
// the application's `map` (application/client/src/udfrun/json-ui/components/udf-map.tsx):
// SAME prop names/semantics (label, param, sendParam, centerLng/Lat, zoom, layers,
// mapStyle, style), fewer props, and MapLibre-with-no-token instead of Mapbox.
//
// Data binds through `layers[].udf` (NOT a flat sql): each layer references a UDF
// returning geometry; the planner synthesizes "SELECT * FROM {{udf}}" per layer and
// the renderer paints each via MapLibre GeoJSON layers (map-layer.tsx). `param` +
// `sendParam` emit the viewport bounds as a "west,south,east,north" string (SQL-safe;
// the application's array form is illegal in Fused SQL — same key, narrowed value).
//
// Thin + node-importable (the schema generator loads it): the heavy MapLibre renderer
// lives in ../maps/* (dynamic maplibre import); the deployed bundle aliases this module
// to ./_map-placeholder (build.mjs).
import { z } from "zod";
import { defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { MapRenderer, type MapLayerSpec } from "../maps/map-renderer";

const layerSchema = z.union([
  z.string().describe("Name of the UDF that returns the layer's geometry."),
  z.object({
    udf: z
      .string()
      .optional()
      .describe("Name of the UDF that returns the layer's geometry (alternative to `sql`)."),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL returning the layer's geometry; may use {{ref}} and $param. Use this (instead of `udf`) when the layer must re-resolve as a $param changes — e.g. a slider filtering the map. Provide exactly one of `udf` / `sql`.",
      ),
    visible: z.boolean().optional().describe("Whether the layer is shown (default true)."),
    vizConfig: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Layer styling — a subset of the application's viz config: fillColor, lineColor, lineWidth, pointRadius, opacity, geometryColumn (default column 'geometry').",
      ),
  }),
]);

export const mapProps = z
  .object({
    label: z.string().optional().describe("Label shown above the map."),
    param: z
      .string()
      .optional()
      .describe(
        'Canvas param to receive the viewport bounds as a "west,south,east,north" string (SQL-safe). Emitted when sendParam is true.',
      ),
    sendParam: z
      .boolean()
      .optional()
      .describe("Emit the viewport bounds to `param` on map move (default false)."),
    centerLng: z.number().optional().describe("Initial center longitude (default -74.0)."),
    centerLat: z.number().optional().describe("Initial center latitude (default 40.7)."),
    zoom: z.number().optional().describe("Initial zoom level (default 12)."),
    layers: z
      .array(layerSchema)
      .describe(
        "Map layers. Each is a UDF name or {udf, visible?, vizConfig?}; the UDF returns the layer's geometry as a GeoJSON-string column.",
      ),
    mapStyle: z
      .enum(["light", "dark", "satellite", "blank"])
      .optional()
      .describe('No-token basemap style (default "dark").'),
  })
  .extend(UNIVERSAL_PROPS.shape);

type MapProps = z.infer<typeof mapProps>;

function MapWidget({ element }: ComponentRenderProps<MapProps>) {
  const p = element.props;
  // The planner normalizes `layers` to objects with _queryId/_sql stamped.
  const rawLayers = (p.layers ?? []) as unknown[];
  const layers: MapLayerSpec[] = rawLayers
    .map((l) => (typeof l === "object" && l !== null ? (l as MapLayerSpec) : null))
    .filter((l): l is MapLayerSpec => l !== null && (typeof l.udf === "string" || typeof l.sql === "string"));

  return (
    <MapRenderer
      label={p.label}
      param={p.param}
      sendParam={p.sendParam ?? false}
      centerLng={p.centerLng ?? -74.0}
      centerLat={p.centerLat ?? 40.7}
      zoom={p.zoom ?? 12}
      mapStyle={p.mapStyle ?? "dark"}
      layers={layers}
      style={(p as { style?: string }).style}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: MapWidget,
    props: mapProps,
    description:
      "Interactive map (MapLibre, no token) of one or more UDF layers; each layer's UDF returns geometry as a GeoJSON-string column. Optionally emits the viewport bounds to a param. A subset of the application's `map`. WHEN TO USE: the simple default for DISPLAYING geometry from a UDF/SQL query (points, lines, polygons) with basic styling. Choose `fused-map` instead when you need deck.gl power — large point clouds, H3/hexbin, heatmap/arc layers, MVT/raster tiles, data-driven color palettes, a legend, or a layer panel. Choose `map-bounds` instead when you need NO data display and only want to capture the visible area as an input param.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
