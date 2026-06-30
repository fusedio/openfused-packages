# `donut-chart`

> Donut chart driven by DuckDB SQL query.

## Why
A **display** component that paints a recharts donut (pie with a center hole) from the rows of a DuckDB query. An author reaches for it to show a part-of-whole / categorical breakdown — each row becomes one slice colored from a cyclic palette, with an optional center total, legend, and percentage labels. It is the RENAME/realignment of the legacy fused `pie-chart` widget to the Fused application's `donut-chart`, and its prop set is a strict, paste-compatible **subset** of the app's `DonutChartPropsSchema` (identical names/types/semantics, never an openfused-only prop). It never runs SQL itself — rows arrive pre-resolved through `useDuckDbSqlQuery`; `writesParam: false` (a chart never writes a param).

## Expectation
- Renders inside a chart-styled `Card` titled by `title`; the universal `style` prop is parsed and applied to the card.
- **Data-bound:** the `sql` prop carries the DuckDB query. Reads FIXED columns from each row: `label` (slice name; tolerates capitalized `Label` fallback, defaults to `""`) and `value` (slice magnitude; tolerates `Value` fallback, coerced via `Number`, defaults to `0`). No `x`/`y`/`nameKey`/`valueKey` column-selection props — columns are fixed.
- Body state machine (in order): no `sql` → empty state captioned "No query"; loading → loading state; error → error state showing the error message; zero rows → empty state; otherwise the chart. Errors/empties render in-card and never blank the widget.
- Chart geometry: recharts `ResponsiveContainer` (fills body; no px `height` prop — the app's flex-1 chart + shrink-0 legend split is reproduced) wrapping a `PieChart`/`Pie` with `dataKey="value"`, `nameKey="label"`, `cx/cy="50%"`, `startAngle={90}`/`endAngle={-270}`, `paddingAngle={1}`, `stroke="none"`. Each slice is a `Cell` filled cyclically from the palette.
- `colors`: when a non-empty array, used as the palette; otherwise the palette is read from the theme's 8 series CSS custom properties, falling back to a built-in 8-color palette. The palette is applied cyclically by slice index.
- `showLabels`: when true, draws percentage labels on slices, but only for slices whose share is `>= 0.05` (5%), rounded to whole percent; smaller slices get `""`. When false, no slice labels.
- `showCenterTotal`: when true (and ≥1 slice), an absolutely-centered overlay over the ring shows a "Total" caption and the summed `value`, locale-formatted. Positioned inline so it overlays the chart region only, not the legend.
- `showLegend`: when true (and ≥1 slice), a scrollable column of legend rows (swatch + ellipsized label, `title` tooltip = `label: value`) below the chart. Row geometry is inline at a fixed 18px per row — there is no stylesheet rule for legend rows — to keep rows on separate baselines.
- `animationMs`: animation is active only when `animationMs > 0` (`isAnimationActive`), with `animationDuration={animationMs}`; animation plays on data changes only, not on zoom/resize.
- Default seeding: the schema `.default()`s (`innerRadius=56`, `outerRadius=88`, `showLegend=true`, `showLabels=false`, `showCenterTotal=true`, `animationMs=300`) are re-applied as JS destructure fallbacks because the render-time zod is stubbed and does not apply defaults at runtime.
- Deliberate subset vs the app: drops the legacy pie-chart `query`/`css`/`x`/`y`/`height`/`donut` props (renamed/removed per the alignment map); rendering uses fused's own lightweight card/loading/error/empty primitives + recharts rather than the app's baseui/shadcn loading-overlay/tooltip — identical CONFIG semantics, not identical rendering.
- Renders everywhere (no map/native-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` | — | DuckDB SQL with `{{udf_name}}` and `$param_name` placeholders; must return `label` and `value` columns. |
| `title` | `string` (optional) | — | Chart title displayed above. |
| `colors` | `array<string>` (optional) | — | Slice color palette (hex strings), used cyclically; overrides the default palette. |
| `innerRadius` | `number` (optional) | `56` | Inner radius in pixels (donut hole size). |
| `outerRadius` | `number` (optional) | `88` | Outer radius in pixels. |
| `showLegend` | `boolean` (optional) | `true` | Show category legend. |
| `showLabels` | `boolean` (optional) | `false` | Show percentage labels on slices. |
| `showCenterTotal` | `boolean` (optional) | `true` | Show total value text in donut center. |
| `animationMs` | `number` (optional) | `300` | Animation duration in ms; `0` disables; plays on data changes, not zoom/resize. |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and merged over defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads columns `label` + `value`, case-tolerant `Label`/`Value` fallbacks).
- **Writes param:** no (`writesParam: false`; a chart never writes a param).

## Notes
- Builds on fused's local card/loading/error/empty primitives plus recharts `ResponsiveContainer`/`PieChart`/`Pie`/`Cell`/`Tooltip`.
- The module exposes a pure legend-row layout helper, the fixed legend row height, a legend-row sub-component, and the component's zod props schema.
- Tooltip styling and palette resolve lazily from the theme's CSS custom properties on the client, with SSR-safe fallbacks when no document is present.
