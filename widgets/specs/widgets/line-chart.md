# `line-chart`

> Line/area chart powered by a DuckDB SQL query; the query must return 'label' and 'value' columns, plus an optional 'series' column for multiple lines.

## Why
A data-bound display component for visualizing a single- or multi-series trend over an ordinal/temporal axis. The author reaches for it to plot a `label`→`value` series (with an optional `series` pivot for multiple lines) returned by a UDF/endpoint query, without selecting x/y columns by hand — the column convention is fixed. Role: **display** (data source: pre-resolved DuckDB rows). App-parity: a strict, paste-compatible SUBSET of the Fused application's `line-chart` component (identical type + prop names + semantics; fewer props; never extra).

## Expectation
- Renders a recharts `LineChart` inside an SVG `ResponsiveContainer` (`width/height 100%`), wrapped in the shared `Card` chrome styled for charts; `title` is the card title.
- **Data-bound:** `props.sql` carries the DuckDB SQL; rows are resolved through `useDuckDbSqlQuery`, keyed on `_queryId` and enabled only when `sql` is present. The query must return `label` + `value` columns (case-insensitive fallback to `Label`, `Value`); an optional `series`/`Series` column triggers a long→wide pivot (one `Line` per distinct series value). There is NO x/y prop — the column convention is fixed.
- Column reads pick the first non-null among the candidate column names. `label` is coerced to a string (empty string when null); `value` is coerced to a number (0 when null). The X axis is always keyed on `label`.
- **Single-series** (no `series` column): rows mapped directly to `{label, value}`; one `Line` with `dataKey="value"`, colored by the first entry of `colors` else `lineColor`. **Multi-series** (`series` present): pivoted into `{label, <seriesA>, <seriesB>, …}` keyed by label, preserving first-seen label order; missing cells default to `0`; one `Line` per series colored cyclically from `colors` (if non-empty) else a built-in series palette (index modulo palette length).
- `curveType` maps to a recharts interpolation type (`linear`→`linear`, `smooth`→`monotone`, `step`→`stepAfter`).
- `showArea` adds a gradient `Area` under each line (per-series `linearGradient`, stops at opacity 0.2→0; `stroke="none"`, `tooltipType="none"`). `showDots` toggles point dots (`r:3`); `activeDot` is always `r:5`. `showGrid` toggles a horizontal-only dashed `CartesianGrid` (`strokeOpacity 0.15`). `showLegend` shows a top `Legend` ONLY when multi-series (auto-hidden for one series). Line `strokeWidth` is fixed at 2; all animation is disabled.
- Y-axis ticks use compact formatting (`1500`→`2K`, `2_300_000`→`2.3M`, `≥1e9`→`B`); a custom tooltip shows the label plus per-series swatch/name/`toLocaleString()` value (multi) or a single `toLocaleString()` value (single).
- **State guards (in-card, never blanks the widget):** no `sql` → `EmptyState label="No query"`; `loading` → `LoadingState`; `error` → `ErrorState message={error}`; resolved-but-empty (`chartData.length === 0`) → `EmptyState`.
- **Deliberate subset vs the app:** app-only presentation knobs (`lineWidth`, `lineOpacity`, `dotSize`, `activeDotSize`, `areaOpacity`, `rotateLabels`, `xAxisFontSize`, `yAxisFontSize`, `bottomMargin`, `beginAtZero`, `yMin`, `yMax`, `animationMs`) are intentionally omitted — a config using them still pastes (extra props accepted app-side) but they are no-ops here.
- Renders **everywhere** (no native-app-only / placeholder restriction).

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` | — | DuckDB SQL with `{{udf_name}}` and `$param_name` placeholders. Must return `label` and `value` columns; optional `series` column for multi-line charts. |
| `title` | `string` (optional) | — | Chart title displayed above the chart. |
| `lineColor` | `string` (optional) | `"#E8FF59"` | Single-series line color. Ignored when multiple series are present (auto-palette used). Default is Fused lime yellow. |
| `colors` | `array<string>` (optional) | — | Series/slice color palette (hex strings), used cyclically. Overrides the default palette. |
| `curveType` | `enum("linear","smooth","step")` (optional) | `"smooth"` | Interpolation curve: straight segments / bezier / stepped lines. |
| `showArea` | `boolean` (optional) | `true` | Fill the area under the line with a gradient. |
| `showDots` | `boolean` (optional) | `false` | Show data point dots on the line. |
| `showGrid` | `boolean` (optional) | `true` | Show subtle grid lines behind the chart. |
| `showLegend` | `boolean` (optional) | `true` | Show legend for multi-series charts. Auto-hidden when there is only one series. |
| `xAxisLabel` | `string` (optional) | — | Axis TITLE for the x axis (names the dimension, e.g. "Date") — distinct from per-tick labels. Always set it; reserves bottom room so it never clips. |
| `yAxisLabel` | `string` (optional) | — | Axis TITLE for the y axis (names the dimension, e.g. "Revenue") — distinct from per-tick labels. Always set it; reserves left room/width so it never clips. |
| `style` | `string` (optional) | — | Inline CSS declaration string, parsed into a style object and merged over the card's default styles. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads `label`/`Label` + `value`/`Value`, plus optional `series`/`Series` pivot column).
- **Writes param:** no.

## Notes
- ui-kit/render helpers: the shared `Card`, `LoadingState`, `ErrorState`, `EmptyState` chrome; chart from `recharts`; data via `@fusedio/widget-sdk` (`useDuckDbSqlQuery`, inline-style parsing, `defineComponent`, `ComponentRenderProps`).
- `_queryId` is read off `element.props` (the existing openfused binding convention) and threaded into the SDK hook as `queryId`; `style` is likewise read off `element.props` per the org-wide css→style rename. `element` is never spread.
