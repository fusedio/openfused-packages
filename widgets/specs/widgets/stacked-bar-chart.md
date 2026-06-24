# `stacked-bar-chart`

> Stacked bar chart driven by a DuckDB SQL query; the query must return 'label' and 'value' columns, with an optional 'series' column to split each bar into a stack.

## Why
A data-bound display component (role: display / source) for showing categorical magnitudes, optionally decomposed into stacked sub-series. The author reaches for it to chart a long/tidy result set — one bar per `label`, each bar stacked by distinct `series`. It is a **strict, paste-compatible SUBSET of the Fused application's `stacked-bar-chart` component** (identical prop names/types/semantics, fewer props, never extra); rendering parity is not required, only config parity.

## Expectation
- Renders a recharts `BarChart` inside a `ResponsiveContainer`, wrapped in the shared chart-card chrome (`title` shown above the chart). The universal `style` is parsed and applied to the card.
- **Data-bound:** `sql` carries the DuckDB query, run via `useDuckDbSqlQuery`. The host resolves rows; the component only paints.
- **Columns read** (case-insensitive fallbacks): `label`|`Label` (→ `""`), `series`|`Series` (→ literal `"value"` when absent), `value`|`Value` (→ `0`).
- **Pivot:** long/tidy rows are grouped by `label` in first-seen order; distinct `series` values become the per-bar stack keys; each cell is the **sum** of `value` for that (label, series). One wide row per label, one numeric key per series.
- **Stacking is unconditional** — every `Bar` shares a single stack id.
- **Color:** single series fills with the first `colors` entry if present, else `barColor` (default Fused lime `#E8FF59`); multi-series cycles `colors` if non-empty, else a built-in 10-color palette, indexed by position modulo palette length.
- **Layout:** `horizontal=true` → recharts `layout="vertical"` (categories on a `YAxis` of `type="category"`, width 110; numeric `XAxis`). `horizontal=false` → categories on `XAxis` (`angle=-45` + `textAnchor="end"` when `rotateLabels`, auto-computed `height` so rotated labels are not clipped); numeric `YAxis` width 55.
- Axis ticks are formatted compactly (`1.5K`/`2.3M`/`1.0B`). `beginAtZero` sets the value-axis domain to `[0, "auto"]`, else `["auto", "auto"]`.
- Legend shown only when `showLegend` and more than one series (top-aligned, font 11). `showValues` adds a `LabelList` per bar segment (position `right` horizontal / `top` vertical), compactly formatted.
- A custom tooltip (plain styled box) lists per-series rows plus a computed Total; tooltip animation is disabled. Bar animation is active only when `animationMs > 0`, with that duration.
- **State fallbacks (in-card, never blanks the widget):** no `sql` → an empty state labelled "No query"; loading → a loading state; error → an error state carrying the message; resolved but zero rows → an empty state.
- `bottomMargin` overrides the bottom margin; defaults to `6` when unset. Top margin is `36` when the legend block renders, else `8`.
- **Defaults applied twice:** zod `.default(...)` plus destructuring defaults in the component body (zod is stubbed at render time).
- Renders everywhere (not map-restricted).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` | — | DuckDB SQL with `{{udf_name}}` / `$param_name` placeholders; must return `label` and `value`, optional `series` splits each bar into a stack. |
| `title` | `string` (optional) | — | Chart title displayed above the chart. |
| `barColor` | `string` (optional) | `"#E8FF59"` | Bar fill for the single-series case (Fused lime); palette used instead when a `series` column is present. |
| `colors` | `array<string>` (optional) | — | Series/slice color palette (hex), used cyclically; overrides the default palette. |
| `horizontal` | `boolean` (optional) | `false` | Render horizontal stacked bars (categories on y-axis). |
| `showGrid` | `boolean` (optional) | `true` | Show subtle grid lines behind bars. |
| `showLegend` | `boolean` (optional) | `true` | Show legend for stacked series (only renders when >1 series). |
| `showValues` | `boolean` (optional) | `false` | Show the numeric value label on each bar segment. |
| `rotateLabels` | `boolean` (optional) | `true` | Rotate x-axis labels by -45 degrees. |
| `xAxisFontSize` | `number` (optional) | `11` | X-axis label font size in pixels. |
| `yAxisFontSize` | `number` (optional) | `11` | Y-axis label font size in pixels. |
| `xAxisLabel` | `string` (optional) | — | Axis TITLE for the x axis (names the dimension, e.g. "Month") — distinct from per-tick labels. Always set it; reserves bottom room so it never clips. |
| `yAxisLabel` | `string` (optional) | — | Axis TITLE for the y axis (names the dimension, e.g. "Count") — distinct from per-tick labels. Always set it; reserves left room/width so it never clips. |
| `beginAtZero` | `boolean` (optional) | `true` | Force value axis to start at 0. |
| `bottomMargin` | `number` (optional) | — | Override bottom margin in pixels (effective default `6`). |
| `animationMs` | `number` (optional) | `300` | Animation duration (ms); `0` disables; only plays on data changes, not zoom/resize. |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and merged over component defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads `label`/`Label`, `value`/`Value`, optional `series`/`Series`).
- **Writes param:** no.

## Notes
- Render behaviour ported from the app for parity (not props): a built-in 10-color series palette, compact tick formatting, and a local tooltip (the app uses baseui/shadcn + a glass loading overlay; here lightweight loading/error/empty states + the shared card chrome reproduce those states so one failing query never blanks the dashboard).
- `barColor` is the openfused single-series fill prop mirroring the app's single-series color semantics; the app's purely-cosmetic extras are intentionally omitted (never extra).
- Renders via recharts (`BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `LabelList`, `ResponsiveContainer`).
