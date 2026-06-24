# `text`

> Static or dynamic text display.

## Why
A display component for a SINGLE text value — either a literal authored string or the first cell of a DuckDB query result. Authors reach for it to label a card, surface a computed scalar inline (e.g. a count or status), or print a heading. It is a strict, paste-compatible SUBSET of the Fused application's `text` component (identical type, prop names — `value`/`sql`/`variant` — types, and element-selection semantics; fewer props, never extra). It is a FULL contract replacement of the retired openfused markdown component: the app `text` is NOT a markdown renderer and the old `content` prop / `react-markdown` wrapper are gone.

## Expectation
- Renders one wrapper element whose tag is chosen by `variant`: `h1`/`h2`/`h3`/`h4` → matching heading tag, `"large"` → `<p>`, everything else (`default`/`muted`/`small`) → `<span>`. The element always carries a per-variant typography style and the parsed `style` prop merged over component defaults. (The app and openfused match config semantics — each variant maps to the same typographic treatment — though rendering need not be pixel-identical.)
- DATA-BOUND via the `sql` prop. The DuckDB result is read as: first row, first column → coerced to string. The column is `columns[0]` (falling back to `Object.keys(firstRow)[0]`); an empty/null/undefined cell → `""`. The hook (`useDuckDbSqlQuery`) stays inert (`enabled: !!sql`) when no `sql` is authored.
- Render priority: **`sql` > `value`** (`displayText = sqlValue || value || ""`). The literal `value` is only shown when `sql` is absent or yields an empty cell.
- Loading state: while `sql` is set AND the query is loading, the displayed text is `"Loading..."` (the app's `finalText` loading branch); otherwise `displayText`.
- `queryId` is read off `element.props._queryId` (resolver-stamped) and threaded explicitly into the hook — the render context also provides it, but passing it keeps the data dependency legible at the call site.
- Not an input: writes no param.
- Deliberate behavioural subset vs the app: the app resolves inline `$param_name`/`{{udf_name}}` placeholders WITHIN a literal `value` (a substitution path outside openfused's allowed import set). openfused renders the authored `value` string AS-IS. The prop name/type/semantics (primary text source, lower priority than `sql`) are preserved — identical CONFIG semantics, reduced dynamism. (Inline `{{ref}}`/`$param` inside `sql` are still resolved server-side as normal.)
- Renders everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `value` | `string` | `""` | Text value to display; supports `$param_name`/`{{udf_name}}` placeholders in the app (rendered as-is in openfused). Lower priority than `sql`. |
| `sql` | `string` | — | DuckDB SQL with `{{ref}}`/`$param` placeholders; returns the first row's first column, coerced to string. Highest priority. |
| `variant` | `enum("default", "muted", "small", "large", "h1", "h2", "h3", "h4")` | `"default"` | Typography variant; also selects the rendered HTML element. |
| `style` | `string` | — | Optional inline CSS declaration string, parsed and merged over component defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads first row / first column, coerced to string).
- **Writes param:** no.

## Notes
- Uses SDK primitives only: `useDuckDbSqlQuery`, the inline-style parser, `defineComponent`, `ComponentRenderProps` from `@fusedio/widget-sdk`. No ui-kit primitives.
- `style` and `_queryId` are read off a narrow typed view of `element.props` (the universal layer still declares `css` internally), so the component stays correct independent of the universal-layer migration.
