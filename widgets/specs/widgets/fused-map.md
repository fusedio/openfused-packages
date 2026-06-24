# `fused-map`

> Rich multi-layer map (deck.gl on a no-token MapLibre basemap): scatterplot/geojson/h3/heatmap/arc + mvt/raster layers, data-driven color (continuous/categorical palettes), tooltips, legend, layer panel, basemap switcher. A subset of the application's fused-map.

## Why
`fused-map` is the heavy, multi-layer mapping component: an interactive deck.gl render over a no-token MapLibre basemap with full chrome (layer panel, basemap switcher, color legend, scale + nav controls). Reach for it when a single map must stack several styled, independently-bound layers (points, polygons, H3, heatmap, arcs, vector/raster tiles) with data-driven color. Its ROLE is primarily **map** (a multi-layer container/source surface) that can secondarily emit the current viewport bounds to a param. **App-parity:** it is a strict, paste-compatible SUBSET of the Fused application's `fused-map` (same prop/layer keys, same semantics, fewer props) — not an OpenFused-owned primitive.

## Expectation
- Renders a map frame (full width, rounded corners, clipped overflow) into which MapLibre + deck.gl (the `MapboxOverlay` in interleaved mode, plus the layer/geo/aggregation packages) are loaded via **dynamic import**. The widget module itself stays node-importable; the deployed bundle aliases the map widgets to a placeholder (see below).
- **Default height (no per-dashboard CSS hacks):** the frame carries a default height **FLOOR** of **420px** (via `.ofw-fmap .ofw-map__frame { min-height: 420px }` in `widget.css`); the inline frame style uses `height: 100%` (no fixed pixel height). The floor is a `min-height` on purpose — it survives the classic collapse where an author/canvas `height: 100%` resolves to **0** against an auto-height ancestor (the prior fixed `height` could be overridden by author `style` to `height:100%` and then collapse, rendering the map blank). The map therefore renders one-shot at ≥420px without any wrapper `height:420px` / `flex:1` hacks. **Author overrides still win:** `style` is parsed and spread **after** the base frame style (inline beats the CSS class), so an explicit `style="height:600px"` (or `min-height`) takes precedence; and a PARENT that pins an explicit height grows the map past the floor via the frame's `height:100%` (no canvas-sizing regression).
- Loading state: an in-frame `Loading map…` overlay while the libs/basemap load. Error state: an in-frame `Map failed: <message>` overlay (the dynamic import / map construction is wrapped in try/catch — failures never blank the widget).
- **Basemap:** `basemap` (a Mapbox style URL or a name) is mapped to a no-token MapLibre basemap by substring: `satellite` / `light` / `blank` → those, otherwise `dark` (the default). When `showBasemapSwitcher` is on, dark/light/satellite chips let the user switch at runtime; the switch re-applies tile layers and is guarded against re-`setStyle`ing the already-applied basemap (avoids a flash/drop of tile layers).
- **Chrome toggles** (`showControls`, `showScale`, `showBasemapSwitcher`, `showLegend`, `showLayerPanel`) all default true: nav control (no compass, top-right), metric scale bar, basemap chips, color legend, and a per-layer visibility checklist (the layer panel renders only when `layers.length`).
- **Layer panel** lets the user toggle each layer's visibility at runtime (local override, keyed by `layer.id`, seeded from `layer.visible ?? true`); a layer hidden by override is dropped from the deck render.
- **Per-layer rendering** (`layers[]`): mvt/raster layers are added as native MapLibre tile sources/layers (raster uses `style.opacity`, default 1; mvt fills with `#E8FF59` at `style.opacity` default 0.4 on `source-layer` = `sourceLayer ?? "default"`). All other types (`scatterplot`/`h3`/`heatmap`/`arc`/`geojson`/`deck-geojson`, and any unknown vector type → `GeoJsonLayer`) are built as deck.gl layers.
- DATA-BINDING is **per layer**, not on the map node: each layer carries its own `sql` (DuckDB SQL with `{{udf}}` / `$param`). The planner synthesizes one query per sql layer and stamps `_sql` + `_queryId` onto the layer. For each layer with a `_queryId`, a headless per-layer loader runs the layer's resolved SQL via `useDuckDbSqlQuery` (enabled only when the layer has a `_queryId`) and reports the rows up. A layer's rows come from `data[_queryId]` when sql-bound, else from inline `data` (a GeoJSON FeatureCollection, converted to rows via its `features`).
- **Rows → geometry:** geometry is read from `geometryColumn` (default `"geometry"`, a GeoJSON-string or object, unwrapping a `Feature`); otherwise a point is synthesized from `latColumn`/`lngColumn` (defaults `"lat"`/`"lng"`) when both are finite. H3 layers read `h3Column` (default `"hex"`). Arc layers read fixed `sourceLng`/`sourceLat`/`targetLng`/`targetLat` columns.
- **Color** (`style.fillColor` / `style.lineColor`): accepts `[r,g,b]`, a CSS string (named: black/white/red/orange/yellow/green/blue/gray, or `#rgb`/`#rrggbb`), or a data-driven spec `{type:"continuous", attr, domain, palette}` (linear ramp over `domain`, default `[0,1]`) / `{type:"categorical", attr, values, palette}` (indexed/hashed into palette stops). Default opacity 0.85 (→ alpha 255*opacity), default `pointRadius` 6, default `lineWidth` 1.
- **Legend:** rendered (when `showLegend`) only for layers whose `fillColor` is a `continuous` color spec and whose `legend !== false`; title comes from `legend.title` → `name` → `attr` → `"Value"`; bar is a gradient of the palette hex over `domain[0]…domain[1]`.
- **Tooltips:** per-layer `tooltip` (`true` = all non-`geometry`/non-`_` props, capped at 8 keys; `string[]` = specific props) is funneled into one deck `getTooltip` over all layers (matched by `layer.id`).
- **Viewport-bounds emission (the only param write):** when `autoSend` is true AND a `param` name is set, the map emits its bounds as a `"w,s,e,n"` string (each coord fixed to 6 decimals) to that param on every `moveend`, via `useFusedParamWithForm` (without broadcasting the default value, no debounce). This is gated on `autoSend` (default false); the spec-level `writesParam` flag is **false** (the map is not an INPUT component). `autoSendDebounceMs` (default 600) is threaded as a prop but bounds emit on `moveend`. The bounds string is scalar and thus SQL-safe as `$param`.
- **WHERE it renders:** NATIVE APP ONLY. The deployed self-contained bundle aliases this module to a placeholder and shows it — the deck.gl/MapLibre render needs external map tiles the bundle does not ship.

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `basemap` | `string` | — (effective `"dark"`) | Basemap; a Mapbox style URL is mapped to a no-token equivalent by name. |
| `centerLng` | `number` | `-98` | Initial center longitude. |
| `centerLat` | `number` | `39.5` | Initial center latitude. |
| `zoom` | `number` | `4` | Initial zoom. |
| `minZoom` | `number` | — | Map min zoom. |
| `maxZoom` | `number` | — | Map max zoom. |
| `layers` | `array<{id, name?, type(enum mvt/raster/geojson/h3/heatmap/arc/scatterplot/deck-geojson), visible?, tileUrl?, minZoom?, maxZoom?, zoomOffset?, maxRequests?, sourceLayer?, data?, sql?, geometryColumn?, h3Column?, latColumn?, lngColumn?, tooltip?(bool\|string[]), legend?(bool\|{title?}), style?}>` | — (effective `[]`) | Map layers; each layer's `sql` is data-bound and stamped with `_sql`/`_queryId` by the planner. |
| `showControls` | `boolean` | `true` | Zoom/nav controls. |
| `showScale` | `boolean` | `true` | Scale bar. |
| `showBasemapSwitcher` | `boolean` | `true` | Dark/light/satellite toggle. |
| `showLegend` | `boolean` | `true` | Color legend for data-driven layers. |
| `showLayerPanel` | `boolean` | `true` | Layer visibility panel. |
| `param` | `string` | — | Canvas param for the viewport bounds (`"w,s,e,n"` string). |
| `autoSend` | `boolean` | `false` | Emit bounds on pan/zoom (`moveend`). |
| `autoSendDebounceMs` | `number` | `600` | Debounce ms for autoSend. |
| `style` | `string` | — | Universal: optional inline-CSS declaration string, parsed and merged **over** the frame's default styles (so an explicit `height`/`min-height` wins over the 420px default floor). |

Per-layer `style` sub-object: `fillColor`, `lineColor`, `lineWidth`, `opacity`, `pointRadius`, `coverage`, `extruded`, `elevationAttr`, `elevationScale` (all optional). `_queryId` / `_sql` on each layer are **(internal; resolver/planner-stamped, not author-set)**.

- **Data-bound:** yes — per-layer, not on the map node. Each layer's `sql` is stamped to `_sql`/`_queryId` and resolved via `useDuckDbSqlQuery`; rows are read into deck/native layers (geometry from `geometryColumn` or `lat`/`lng`/`h3Column`; color attrs from `style.*Color.attr`).
- **Writes param:** no (`writesParam: false`). It is NOT an input component; however, when `autoSend` is true and `param` is set, it broadcasts the viewport bounds as a scalar `"w,s,e,n"` string to `props.param` via `useFusedParamWithForm`.

## Notes
- The heavy renderer draws MapLibre + the deck.gl `MapboxOverlay` with the full chrome and the basemap-switch guard; a headless per-layer loader resolves each layer's SQL; layer construction dispatches on layer `type` and applies the color/geometry conversion; named basemaps and color palettes are resolved from lookup tables.
- deck layer ids are namespaced with a `fused-`-prefixed form of `layer.id` and native tile sources with a `tile-`-prefixed form — the tooltip handler strips the deck prefix to match a layer def.
- Deployed-bundle caveat applies to this widget and its two siblings (`map`, `map-bounds`) only: all three are native-app-only with a deployed-bundle placeholder.
