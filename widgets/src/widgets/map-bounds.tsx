// widgets/map-bounds.tsx — interactive map that writes its viewport bounds to a
// param (no data input). A strict SUBSET of the application's `map-bounds`
// (application/client/src/udfrun/json-ui/components/map-bounds.tsx): identical
// prop names/semantics, fewer props, and MapLibre-with-no-token instead of
// Mapbox (spec/ui/json-ui.md). Bounds are emitted as a "west,south,east,north"
// string (6dp) — a SQL-safe scalar usable as $param (an array param would be
// rejected by the SQL layer, json-ui-data.md). The application's array-shaped
// bounds param is therefore narrowed to this string form here.
//
// This module is intentionally thin and node-importable (the schema generator
// loads it): the heavy MapLibre renderer lives in ../maps/map-bounds-renderer,
// which loads maplibre-gl dynamically. In the deployed self-contained bundle the
// whole module is aliased to ./_map-placeholder (build.mjs) — maps render only in
// the native app for now.
import { z } from "zod";
import { defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { MapBoundsRenderer } from "../maps/map-bounds-renderer";

export const mapBoundsProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        'Canvas param to receive the viewport bounds as a "west,south,east,north" string (6dp). SQL-safe scalar — reference it as $param to filter queries.',
      ),
    label: z.string().optional().describe("Label shown above the map."),
    centerLng: z.number().optional().describe("Initial center longitude (default -74.0)."),
    centerLat: z.number().optional().describe("Initial center latitude (default 40.7)."),
    zoom: z.number().optional().describe("Initial zoom level (default 12)."),
    mapStyle: z
      .enum(["dark", "light", "satellite", "blank"])
      .optional()
      .describe('No-token basemap style (default "dark").'),
    buttonLabel: z
      .string()
      .optional()
      .describe('Label for the manual send-view button (default "Send view").'),
    autoSend: z
      .boolean()
      .optional()
      .describe("Emit bounds automatically on map move instead of on button press (default false)."),
    autoSendDebounceMs: z
      .number()
      .optional()
      .describe("Debounce in ms for autoSend emits (default 600)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type MapBoundsProps = z.infer<typeof mapBoundsProps>;

function MapBounds({ element }: ComponentRenderProps<MapBoundsProps>) {
  const p = element.props;
  return (
    <MapBoundsRenderer
      param={p.param}
      label={p.label}
      centerLng={p.centerLng ?? -74.0}
      centerLat={p.centerLat ?? 40.7}
      zoom={p.zoom ?? 12}
      mapStyle={p.mapStyle ?? "dark"}
      buttonLabel={p.buttonLabel ?? "Send view"}
      autoSend={p.autoSend ?? false}
      autoSendDebounceMs={p.autoSendDebounceMs ?? 600}
      style={(p as { style?: string }).style}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: MapBounds,
    props: mapBoundsProps,
    description:
      'Interactive map whose ONLY job is to write its viewport bounds ("west,south,east,north") to a param — it is an INPUT control, not a data display. No layers, no geometry. WHEN TO USE: pair it with data-bound widgets (sql-table/charts/`map`) whose queries filter on `$param` so panning/zooming re-runs them over the visible area (a spatial filter). If you want to SHOW geometry on a map, use `map` (simple) or `fused-map` (advanced) instead — both can ALSO emit bounds via their own bounds param, so you rarely need `map-bounds` alongside them. MapLibre, no token.',
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
