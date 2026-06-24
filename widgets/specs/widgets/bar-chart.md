# `bar-chart`

> Bar chart powered by a DuckDB SQL query; the query must return 'label' and 'value' columns. Set clickParam to write the clicked bar's label (a scalar) to a param — usable for in-widget drill-down via $param and reported in session feedback.

## Why
A data-bound display component that renders a single-series bar chart (recharts) over the rows of a DuckDB SQL query. Authors reach for it to visualize one categorical-to-numeric series — counts, totals, rankings — directly from a `{{udf}}`/`$param` query without writing render code. Its ROLE is primarily **display/source**, with an optional **input/feedback** facet: when `clickParam` is set it doubles as a selection input. The prop contract is a strict, paste-compatible **SUBSET of the Fused app's `bar-chart`** (identical names/types/semantics, single-series only), EXCEPT `clickParam`, which is an OpenFused-owned feedback extension (not an app prop).

## Expectation
- Renders inside the shared `Card` chrome (title from `title`, the universal `style` prop applied to it). The chart body is a recharts `ResponsiveContainer` → `BarChart` sized container-driven (no `x`/`height` props).
- DATA-BOUND: `sql` carries the DuckDB query. Rows are read via `useDuckDbSqlQuery`, keyed by the resolver-stamped `_queryId` and enabled only when `sql` is present.
- Reads EXACTLY two columns per row: `label` (case-insensitive fallback to `Label`, else `""`) and `value` (case-insensitive fallback to `Value`, else `0`); `value` is coerced via `Number(...)`. Single series only — no multi-series `y`, `stacked`, or `x` props.
- Layout: `horizontal=true` renders horizontal bars (categories on y-axis via `YAxis dataKey="label"` type category width 100; values on x-axis); otherwise vertical (categories on x-axis, rotated -45° when `rotateLabels`). Bar corner radius applies `[r,r,0,0]` (vertical) or `[0,r,r,0]` (horizontal).
- Value axis uses compact tick formatting (`1500→"2K"`, `2_300_000→"2.3M"`, `≥1e9→"B"`) and starts at 0 when `beginAtZero` (`domain [0,"auto"]`), else `["auto","auto"]`.
- `showValues` adds a per-bar `LabelList` (position `top` vertical / `right` horizontal) using the same compact formatter at font-size 11; right margin widens to 36 to fit labels.
- `showGrid` adds subtle horizontal `CartesianGrid` lines (no vertical, `strokeOpacity 0.15`). `hoverColor` sets `activeBar` highlight fill; omitted → no hover highlight. `animationMs>0` enables bar animation; `0` disables it.
- Vertical-layout x-axis height is auto-computed from the longest label (canvas `measureText`, with a length-estimate fallback) so rotated labels are not clipped; `bottomMargin` overrides the bottom margin (default 6).
- INPUT facet (`clickParam`): the `useFusedParam` hook is called UNCONDITIONALLY; the param binding is inert unless `clickParam` is a non-empty string, in which case it is plain local state and the write is a no-op. The param defaults to an empty string and is not broadcast until a click, so it stays untouched initially. Clicking a bar broadcasts the bar's `label` value — a SCALAR string — coerced to a string; null/undefined labels are skipped. As a scalar, this param is SQL-safe for `$param` text substitution. The bar shows a pointer cursor and handles clicks only when `clickParam` is set.
- Body states (in-card, never blanks the widget/dashboard): no `sql` → `EmptyState label="No query"`; `loading` → `LoadingState`; `error` → `ErrorState message={error}`; empty/zero rows → `EmptyState`.
- Tooltip is a lightweight custom box showing the label and the locale-formatted value; the recharts cursor highlight is off, no tooltip animation.
- Deliberate subset vs the Fused app: rendering parity is NOT required (app uses baseui/shadcn/GlassLoadingOverlay; here lightweight Card/Loading/Error/Empty helpers reproduce the states). CONFIG parity holds — every prop name/type/semantic matches the app, with fewer props (single series, no `stacked`/`x`/`height`).
- Renders EVERYWHERE (no native-app-only restriction; not a map widget).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `sql` | string | — | DuckDB SQL with `{{udf_name}}` and `$param_name` placeholders; must return `label` and `value` columns. |
| `title` | string (optional) | — | Chart title displayed above the chart. |
| `barColor` | string (optional) | `"#E8FF59"` | Bar fill color (default Fused lime yellow). |
| `barOpacity` | number (optional) | `1` | Bar fill opacity 0 (transparent) → 1 (solid). |
| `barRadius` | number (optional) | `4` | Bar corner radius in pixels (0 for sharp corners). |
| `hoverColor` | string (optional) | — | Bar fill color on hover; omitted → no hover highlight. |
| `showGrid` | boolean (optional) | `false` | Show subtle horizontal grid lines behind bars. |
| `rotateLabels` | boolean (optional) | `true` | Rotate x-axis labels -45°; useful for long category names. |
| `horizontal` | boolean (optional) | `false` | Render horizontal bars (categories on y-axis, values on x-axis); good for ranked lists. |
| `showValues` | boolean (optional) | `false` | Show the numeric value label on each bar. |
| `xAxisFontSize` | number (optional) | `11` | Font size for x-axis labels in pixels. |
| `yAxisFontSize` | number (optional) | `11` | Font size for y-axis labels in pixels. |
| `xAxisLabel` | string (optional) | — | Axis TITLE for the x axis (names the dimension, e.g. "Species") — distinct from per-tick labels. Always set it; reserves bottom room so it never clips. |
| `yAxisLabel` | string (optional) | — | Axis TITLE for the y axis (names the dimension, e.g. "Count") — distinct from per-tick labels. Always set it; reserves left room/width so it never clips. |
| `bottomMargin` | number (optional) | — | Bottom margin in pixels; overrides the auto value from `rotateLabels` (use when labels clip). |
| `beginAtZero` | boolean (optional) | `true` | Force the value axis to start at 0. |
| `animationMs` | number (optional) | `300` | Bar animation duration in ms; 0 disables animation. |
| `clickParam` | string (optional) | — | Param name that receives the clicked bar's category (`label`, a scalar string); drives drill-down via `$param` and rides in session feedback. |
| `style` | string (optional) | — | Inline CSS declaration string, parsed and merged over the component's defaults. |
| `_queryId` | string | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads columns `label` and `value`, case-insensitive `Label`/`Value` fallback, `value` coerced to Number).
- **Writes param:** `writesParam: false` at the definition level. It conditionally writes a SCALAR string (the clicked bar's `label`) to `props.clickParam` via `useFusedParam` only when `clickParam` is set and a bar is clicked — this is an OpenFused feedback extension, not the standard input contract.

## Notes
- ui-kit / shared primitives: the shared `Card`, `LoadingState`, `ErrorState`, and `EmptyState` chrome; chart built on `recharts` (`ResponsiveContainer`, `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `LabelList`).
- SDK hooks: `useDuckDbSqlQuery` (rows/loading/error), `useFusedParam` (click-to-param); the universal `style` prop is parsed into inline styles; registered as a catalog entry via `defineComponent`.
- `clickParam` is specified under spec/ui/json-ui.md § Actions & selection; the scalar it writes is SQL-safe for `$param` substitution and is reported in every session feedback payload (parley/feedback loop).
- Helper render behaviour (compact tick formatting, the custom tooltip box, and auto-computed x-axis height) is ported from the app for parity but is NOT part of the prop contract.
