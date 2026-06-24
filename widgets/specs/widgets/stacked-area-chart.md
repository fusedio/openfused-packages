# `stacked-area-chart`

> Stacked area chart driven by DuckDB SQL query.

## Why
A DISPLAY component that renders a recharts stacked area chart from a DuckDB query, for showing how multiple series contribute to a total over an ordered set of labels. The author reaches for it when they have a long/tidy `label`/`series`/`value` result and want each series painted as a stacked band. App-parity: a strict, paste-compatible SUBSET of the Fused application's `stacked-area-chart` (identical prop names/types/semantics; fewer props, never extra). It SUPERSEDES the legacy openfused wide-format `area-chart` — an intentional break (long/tidy input, unconditional stacking, container-driven sizing), not a clean superset.

## Expectation
- Renders inside the shared `Card` chrome (with optional `title`); the chart body is a recharts `<AreaChart>` inside a `ResponsiveContainer` (`width="100%" height="100%"`) that fills its flex parent — no fixed height/width prop.
- DATA-BOUND: `sql` carries the DuckDB query and MUST return `label`, `series`, `value` columns. Rows are read via `useDuckDbSqlQuery`, run only when `sql` is present, keyed on the query id threaded from the node's `_queryId` prop.
- Long/tidy → wide pivot (adopted from the app exactly): group rows by `label` in first-seen order; collect distinct `series` into series keys; for each `(label, series)` the cell is the SUM of `value`. Case-insensitive column fallbacks: `label`|`Label` (default `""`), `series`|`Series` (default literal `'value'`), `value`|`Value` (default `0`). Missing series cells fill to `0`.
- One `<Area>` per distinct series, each with `stackId="stack"` — stacking is UNCONDITIONAL. Series colors cycle through `colors` (if provided and non-empty) else a built-in palette of 10 hex colors.
- `curveType` maps to recharts `Area type`: `linear`→`linear`, `smooth`→`monotone`, `step`→`stepAfter`. `areaOpacity` sets `fillOpacity`.
- Legend renders only when `showLegend` AND there is more than one series key. Grid (`showGrid`), brush slider (`showBrush` + `brushHeight`), and label rotation (`rotateLabels`, -45°) are toggled by their props. X-axis height is auto-computed from the longest label, `xAxisFontSize`, rotation, and brush padding so labels/brush are not clipped; X-axis tick `interval` thins to ~8 ticks when more than 10 labels.
- Y-axis: ticks formatted compactly (1.5K→"2K", 2.3M→"2.3M", 2.3B→"2.3B"); domain min = `yMin` if set else `0` when `beginAtZero` else `"auto"`; domain max = `yMax` if set else `"auto"`. Bottom margin = `bottomMargin ?? 6`.
- A custom in-card tooltip shows per-series rows (color swatch + name + localized value) plus a computed Total; the recharts `Tooltip` has `cursor={false}` and zero animation. Area animation plays only when `animationMs > 0`, with `animationDuration = animationMs`.
- State guards (all in-card via `EmptyState`/`LoadingState`/`ErrorState`, never blanking the dashboard): no `sql` → `EmptyState "No query"`; loading → `LoadingState`; error → `ErrorState(message)`; empty pivot (`chartData.length === 0`) → `EmptyState`.
- Deliberate subset vs the app: drops the legacy openfused `x`, `y`, `height`, `stacked` props (no app equivalent); sizing is container-driven. Rendering parity is NOT required (this renderer uses lightweight Card/state helpers and a plain styled tooltip instead of baseui/shadcn) — only CONFIG parity is guaranteed.
- Renders EVERYWHERE (not a map widget; no native-app-only restriction).

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` (required) | — | DuckDB SQL with `{{udf_name}}`/`$param_name` placeholders; must return `label`, `series`, `value` columns. |
| `title` | `string` | — | Chart title displayed above the chart. |
| `colors` | `array<string>` | — | Series color palette (hex), used cyclically; overrides the default palette. |
| `areaOpacity` | `number` | `0.6` | Opacity of each stacked area (0–1). |
| `curveType` | `enum("linear","smooth","step")` | `"smooth"` | Interpolation curve type. |
| `showGrid` | `boolean` | `true` | Show subtle grid lines behind the chart. |
| `showLegend` | `boolean` | `true` | Show legend for stacked series (only when >1 series). |
| `showBrush` | `boolean` | `true` | Show brush slider for range selection. |
| `brushHeight` | `number` | `30` | Height of brush slider in pixels. |
| `rotateLabels` | `boolean` | `true` | Rotate x-axis labels by -45 degrees. |
| `xAxisFontSize` | `number` | `11` | X-axis label font size in pixels. |
| `yAxisFontSize` | `number` | `11` | Y-axis label font size in pixels. |
| `xAxisLabel` | `string` (optional) | — | Axis TITLE for the x axis (names the dimension, e.g. "Date") — distinct from per-tick labels. Always set it; reserves bottom room so it never clips. |
| `yAxisLabel` | `string` (optional) | — | Axis TITLE for the y axis (names the dimension, e.g. "Visitors") — distinct from per-tick labels. Always set it; reserves left room/width so it never clips. |
| `beginAtZero` | `boolean` | `true` | Force y-axis to start at zero. |
| `yMin` | `number` | — | Fixed minimum y-axis value. |
| `yMax` | `number` | — | Fixed maximum y-axis value. |
| `bottomMargin` | `number` | — | Override bottom margin in pixels (defaults to 6). |
| `animationMs` | `number` | `300` | Animation duration (ms); 0 disables; plays on data changes only. |
| `style` | `string` | — | Optional inline-CSS declaration string, parsed and merged over the component's default styles. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads columns `label`, `series`, `value`, case-insensitive fallbacks `Label`/`Series`/`Value`).
- **Writes param:** no.

## Notes
- Chrome/state primitives (`Card`, `LoadingState`, `ErrorState`, `EmptyState`) come from the shared card helpers; charting via `recharts` (`ResponsiveContainer`, `AreaChart`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `Brush`).
- At render time `zod` is aliased to a stub, so `.default(...)` values are NO-OPs at runtime; every default is ALSO applied via destructuring defaults in the component body — keep the two in sync. The real zod schema only feeds the generated agent-facing catalog (`components.json`).
