# `scatter-chart`

> Scatter chart driven by a DuckDB SQL query; the query must return numeric 'x' and 'y' columns, with optional 'series' (one scatter per series), 'size' (bubble radius), and 'label' (tooltip) columns.

## Why
A display component for plotting one numeric quantity against another as a 2D point cloud, with optional per-series coloring (one `<Scatter>` per distinct series), bubble sizing, and tooltips. Authors reach for it to surface a data-bound correlation/distribution view inside a dashboard card. ROLE: display (data-bound source). App-parity: a strict, paste-compatible SUBSET of the Fused application's `scatter-chart` component — identical type, prop names, and semantics, with fewer props (the app's extra cosmetic bubble props are intentionally omitted).

## Expectation
- Renders inside the shared chart-card chrome, titled by `title`. The chart body is a recharts `<ScatterChart>` in a `<ResponsiveContainer>` that fills its container's width and height.
- DATA-BOUND: `sql` carries the DuckDB query; rows are resolved via `useDuckDbSqlQuery`, enabled only when `sql` is set. The query MUST return numeric `x` and `y` columns; optional columns `series`, `size`, `label`. Column reads are case-insensitive with fixed fallbacks: `x|X`, `y|Y`, `series|Series` (default `"value"`), `size|Size`, `label|Label` (default = the series name).
- Points are grouped by `series`. More than one distinct series triggers multi-series mode, rendering one `<Scatter>` per series. If any row supplied a `size`/`Size`, a recharts `<ZAxis>` (range `[10,160]`) drives bubble radius; otherwise every point uses the default point size (70).
- Coloring: multi-series uses the palette (`colors` if a non-empty array, else the built-in 10-color series palette, indexed cyclically by position); single-series uses the first `colors` entry, falling back to `pointColor` (default lime `#E8FF59`). Points render at 85% fill opacity.
- Axes: numeric recharts `<XAxis dataKey="x">` / `<YAxis dataKey="y">`, both with auto domain, no axis/tick lines, and compact tick formatting (`1.5K`, `2.3M`, `2.0B`). `xLabel`/`yLabel` set the axis title and font size comes from `xAxisFontSize`/`yAxisFontSize` (default 11). Grid (`showGrid`, default true) is a faint dashed `CartesianGrid`. Legend (`showLegend`, default true) only shows when multiple series are present.
- Tooltip: a custom in-card tooltip showing the point's `label`/`series` heading plus locale-formatted `x` and `y`, with recharts tooltip animation disabled.
- Animation: the `<Scatter>` animates for `animationMs` (default 300ms; `0` disables) and plays only on data changes, not zoom/resize.
- Guards & fallbacks (all in-card, never blanking the widget): no `sql` → a "No query" empty state; loading → a loading state; query error → an error state with the message; zero plottable points → an empty state. Rows whose `x` or `y` is non-finite (NaN/Infinity) are skipped so they don't distort recharts' auto domain; a non-finite `size` falls back to the default point size.
- Deliberate subset vs the Fused app: rendering parity is NOT required (the app uses baseui/shadcn/`GlassLoadingOverlay`; here lightweight loading/error/empty states + the shared card chrome reproduce those states) — CONFIG parity IS guaranteed. The app's extra cosmetic bubble props are omitted.
- WHERE it renders: everywhere (no native-only restriction).

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` | — | DuckDB SQL with `{{udf_name}}` / `$param_name` placeholders; must return numeric `x`, `y`; optional `series`, `size`, `label`. |
| `title` | `string` (optional) | — | Chart title displayed above the chart. |
| `pointColor` | `string` (optional) | `"#E8FF59"` | Point color for single-series charts (Fused lime); palette is used instead when a `series` column is present. |
| `colors` | `array<string>` (optional) | — | Series/slice color palette (hex), used cyclically; overrides the default palette. |
| `showGrid` | `boolean` (optional) | `true` | Show subtle grid lines behind points. |
| `showLegend` | `boolean` (optional) | `true` | Show legend when multiple series are present. |
| `xLabel` | `string` (optional) | — | Optional x-axis title. |
| `yLabel` | `string` (optional) | — | Optional y-axis title. |
| `xAxisFontSize` | `number` (optional) | `11` | X-axis label font size in pixels. |
| `yAxisFontSize` | `number` (optional) | `11` | Y-axis label font size in pixels. |
| `animationMs` | `number` (optional) | `300` | Animation duration (ms); `0` disables; plays only on data changes. |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and merged over the card's defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads columns `x`/`X`, `y`/`Y`, optional `series`/`Series`, `size`/`Size`, `label`/`Label`).
- **Writes param:** no.

## Notes
- Built on the shared chart-card chrome and its loading/error/empty states; charting via `recharts` (`ResponsiveContainer`, `ScatterChart`, `Scatter`, `XAxis`, `YAxis`, `ZAxis`, `CartesianGrid`, `Tooltip`, `Legend`).
- Render behaviour (not props): a built-in 10-color series palette, a default point size of 70, compact axis-tick formatting, and an inline custom tooltip.
- `_queryId` is threaded from the node's props into `useDuckDbSqlQuery` as its query id (the openfused binding convention); `style` is read off the node's props per the org-wide css→style rename. At render time `zod` is stubbed, so every default is also applied via destructuring defaults in the component body.
