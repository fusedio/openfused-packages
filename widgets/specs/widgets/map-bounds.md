# `map-bounds`

> Interactive map that writes its viewport bounds ("west,south,east,north") to a param. No data input; pair with queries that filter on $param. MapLibre, no token.

## Why
`map-bounds` is an **input** component: an interactive MapLibre map whose only output is its current viewport bounds, broadcast to a param as a `"west,south,east,north"` string. The author reaches for it to give a human a spatial picker — pan/zoom the map, then drive downstream SQL queries by filtering on `$param`. It takes no data in (it is not data-bound). It is a strict, paste-compatible **subset of the application's `map-bounds`** (identical prop names/semantics, fewer props, MapLibre-with-no-token instead of Mapbox), with the deliberate narrowing that the app's array-shaped bounds param is emitted here as a SQL-safe **string** scalar.

## Expectation
- Renders a map container: an optional label (when `label` is set) above a map frame (full-width, rounded corners, clipped overflow), with the universal `style` prop merged over those defaults. Like its `map`/`fused-map` siblings the frame carries a default height **FLOOR** of **360px** (`.ofw-map__frame { min-height: 360px }` in `widget.css`) and an inline `height: 100%` (no fixed pixel height) — a `min-height` floor so the frame never collapses to 0 when an author/canvas `height: 100%` resolves against an auto-height ancestor; an explicit author `height`/`min-height` (spread inline, after the base style) still wins, and a parent that pins a height grows it past the floor.
- The MapLibre map mounts once: MapLibre and its stylesheet are loaded **dynamically** inside the mount effect (so the widget module stays node-importable by the schema generator). A navigation control (no compass) is added top-right; the GL canvas is kept sized to its container as it resizes.
- **Init-once lifecycle:** the map is created from `centerLng`/`centerLat`/`zoom`/`mapStyle` at mount; post-mount prop edits are NOT re-applied.
- Loading state: a "Loading map…" overlay shows until the map finishes loading (status becomes ready). Error state: any failure (e.g. the dynamic load) puts the map in an error state and renders an in-frame "Map failed: {message}" overlay — the error stays inside the card and never blanks the widget.
- **Emit semantics:** bounds are read from the live map viewport and formatted to 6 decimal places as `"<west>,<south>,<east>,<north>"`.
  - When `autoSend` is **false** (default): a send button (`buttonLabel`) is rendered; it is disabled until the map is ready and emits on click. No move handler is attached.
  - When `autoSend` is **true**: no button is rendered; emits fire when the map stops moving, debounced by `autoSendDebounceMs` (when `> 0`; otherwise emits immediately).
- **Value shape (SQL-safety):** broadcasts a single **string** scalar — SQL-safe, usable directly as `$param` in queries that filter on the viewport. This is the deliberate narrowing of the app's array-shaped bounds param to a string; an array param would be rejected by the SQL layer (json-ui-data.md).
- **Default seeding:** the param hook (`useFusedParamWithForm`, typed to a string) seeds an empty default and does NOT broadcast it — nothing is written until the first manual or auto emit. The hook does no debouncing of its own (the move handler does its own debouncing).
- **Where it renders:** native app ONLY. In the deployed self-contained bundle the whole module is aliased to a map-placeholder, which shows a placeholder — maps need external tiles the bundle does not ship.

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `param` | string | — | Canvas param to receive the viewport bounds as a `"west,south,east,north"` string (6dp); SQL-safe scalar referenced as `$param`. |
| `label` | string | — | Label shown above the map. |
| `centerLng` | number | `-74.0` | Initial center longitude. |
| `centerLat` | number | `40.7` | Initial center latitude. |
| `zoom` | number | `12` | Initial zoom level. |
| `mapStyle` | enum(`dark`, `light`, `satellite`, `blank`) | `dark` | No-token basemap style. |
| `buttonLabel` | string | `"Send view"` | Label for the manual send-view button. |
| `autoSend` | boolean | `false` | Emit bounds automatically on map move instead of on button press. |
| `autoSendDebounceMs` | number | `600` | Debounce in ms for `autoSend` emits. |
| `style` | string | — | Optional inline CSS declaration string merged over default styles. |

**Data-bound:** no.
**Writes param:** yes (`writesParam: true`; broadcasts a `"west,south,east,north"` 6dp string scalar to `props.param`).

## Notes
- Defaults are applied at the call boundary in the widget wrapper (`?? -74.0`, `?? 40.7`, `?? 12`, `?? "dark"`, `?? "Send view"`, `?? false`, `?? 600`) — the zod props are all `.optional()` with no `.default()`, so the documented defaults live in the widget wrapper, not the schema.
- The heavy map renderer is split out of the widget module (so the widget module stays node-importable and the library code-splits); basemap styles are resolved by name from a no-token basemap catalog.
- Uses the ui-kit `Button` for the manual send-view control, and the SDK's `useFusedParamWithForm` plus the universal `style`-parsing helper.
- `map-bounds`, `map`, and `fused-map` are the three native-app-only map widgets; all show a placeholder in the deployed bundle.
