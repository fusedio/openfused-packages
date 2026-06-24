# `heatmap-chart`

> Matrix heatmap driven by a DuckDB SQL query; the query must return 'x', 'y', and 'value' columns. Each cell is colored by linear interpolation between lowColor and highColor across the value domain.

## Why
A display component for visualizing a 2-D grid of magnitudes — distinct `x` values become columns, distinct `y` values become rows, and each cell's color encodes its `value`. Authors reach for it to render a pivoted matrix (e.g. day × hour activity, category × region counts) where a table would be hard to scan. It is a DATA-BOUND, read-only display widget (it never writes a param). App-parity: a strict, paste-compatible SUBSET of the Fused application's `heatmap-chart` component — identical type, prop names, and semantics, with FEWER props (the app's extra layout-sizing props are intentionally omitted; never extra). Rendering parity is NOT required, only config parity.

## Expectation
- Renders a SELF-CONTAINED CSS grid using inline styles only (no recharts; there is no recharts primitive for a matrix heatmap). Distinct `x` values become columns in first-seen order; distinct `y` values become rows in first-seen order. Y-axis labels sit in a fixed-width column; a column-header row sits above the value cells. A min→max color-gradient legend renders below the matrix.
- Wrapped in the shared `Card` chrome styled for charts, titled by `title`, with the universal `style` prop parsed and applied to the Card.
- DATA-BOUND: the SQL is carried by `sql`. Rows are fetched via `useDuckDbSqlQuery` (passing the resolver-stamped query id and enabling the query only when `sql` is set). From each row it reads three columns with case-insensitive fallback (adopted from the app): `x` (falls back to `X`, else `""`), `y` (falls back to `Y`, else `""`), and `value` (falls back to `Value`, else `0`).
- Cell coloring: tracks `min`/`max` over all coerced values; each cell's color is a linear interpolation from `lowColor` to `highColor` at the value's position in the domain, where the span is `(max - min)` and falls back to `1` when all values are equal. Hex colors (`#rgb` or `#rrggbb`) are parsed and linearly interpolated to an `rgb(...)` string; the interpolation fraction is clamped to `[0, 1]`. Cell text color flips to dark (`#111827`) when the value sits above 55% of the domain, else light (`#e5e7eb`). When `showValues` is true, each cell shows its value with thousands separators; each cell carries a `title` tooltip `"<x>, <y>: <value>"`.
- Value coercion guard: a non-numeric/missing/non-finite cell value is coerced to `0` (via `Number(...)` then `Number.isFinite` check) so one dirty value can't poison the min/max domain (which would yield a NaN span and invalid `rgb()` on every cell). A missing matrix cell (`${y}::${x}` not present) renders as `0`.
- State precedence in the card body: no `sql` → an empty state labeled "No query"; else loading → a loading state; else error → an error state showing the error message; else no rows / empty axes (either the column or row axis is empty) → an empty state; else the heatmap grid. Errors render in-card and never blank the dashboard.
- WHERE it renders: everywhere (it is a pure CSS/inline-styles widget needing no external tiles).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` (required) | — | DuckDB SQL query with `{{udf_name}}` and `$param_name` placeholders. Must return `x`, `y`, and `value` columns. |
| `title` | `string` (optional) | — | Chart title displayed above the chart. |
| `showValues` | `boolean` (optional) | `false` | Show the numeric value inside each cell. |
| `lowColor` | `string` (optional) | `"#111827"` | Color for the minimum value. |
| `highColor` | `string` (optional) | `"#E8FF59"` | Color for the maximum value (Fused lime). |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and applied to the Card. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) Threaded into `useDuckDbSqlQuery` as the query id. |

- **Data-bound:** yes (`sql` → reads columns `x`/`X`, `y`/`Y`, `value`/`Value`).
- **Writes param:** no.

## Notes
- The hex-parsing and color-interpolation behavior is ported from the app for rendering parity (render behaviour, not props); an unparseable hex falls back to black.
- Layout sizing is fixed: cells have a small uniform gap, a minimum cell height, a minimum column width, and a fixed-width row-label column; the column template repeats one flexible track per distinct `x` value down to that minimum width.
- Uses the shared `Card`, loading, error, and empty-state chrome (lightweight replacements for the app's baseui/shadcn/glass loading overlay so one failing query never blanks the dashboard).
- At render time `zod` validation is stubbed out, so every prop default is ALSO applied in the component body via destructuring defaults (`showValues = false`, `lowColor = "#111827"`, `highColor = "#E8FF59"`) — mirroring the app.
