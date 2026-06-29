# `metric`

> Dashboard metric card with formatted value.

## Why
`metric` is a DISPLAY component: a single, large, formatted number with an optional label below it, rendered inside a `Card` — the "stat tile" of a dashboard. Authors reach for it to surface one headline figure (a count, an average, a total) either from a static literal or from a DuckDB SQL aggregate resolved server-side. It is a strict, paste-compatible SUBSET of the Fused application's `metric` component (identical prop names/types/semantics, fewer props implemented; it is the rename of the former `stat`). Where the app depends on machinery outside fused's lightweight surface, those features are deliberately dropped (see Expectation).

## Expectation
- Renders a `Card` container holding the formatted value (`{prefix}{displayValue}{suffix}`) as a large number, and — only when `label` is non-empty — a smaller label beneath it. No theme/baseui; plain HTML.
- The value is given an inline font size of `size` pixels (falling back to 36 when `size` is not a positive number) and an inline `color` (only when truthy; else inherits theme).
- **Data-bound:** when a non-empty `sql` is present it is resolved with `useDuckDbSqlQuery`. The displayed raw value is the FIRST COLUMN of the FIRST ROW — keyed by the resolver-provided column order (authoritative SQL column order, e.g. an aggregate expression name like `COUNT(*)`), falling back to the first key of the first row only when no column order is provided.
- **Priority rule:** `sql` (when it returns ≥1 row) WINS over the static `value`; otherwise the static `value` prop is used.
- **Formatting:** `"none"` passes the raw string through unchanged; otherwise the raw is coerced to a number and, if not numeric, returned as-is. `"compact"` abbreviates with B/M/K suffixes (e.g. dividing by 1e9 and appending "B"; integers under 1000 print with 0 decimals, non-integers with `decimals`). `"comma"` adds en-US thousand separators with up to `decimals` fraction digits. Negative values keep their sign.
- **Loading:** an ellipsis placeholder (`…`) is shown ONLY when a `sql` is present, the query is loading, and nothing has resolved yet — i.e. before any value has resolved. A background re-resolve or an SDK hook that pins loading true must NOT blank an already-resolved metric (the "tiles stuck on …" symptom); resolved data always wins.
- Empty/null first cell renders as `""` (app convention), NOT the old `stat` em-dash.
- The query id is read off the resolver-stamped `_queryId` prop and threaded into the hook (belt-and-suspenders alongside the binding context).
- **Deliberate subsets vs the Fused app:** (1) no `$param` substitution on `value` — `$param` is NOT substituted inside a literal `value` (the prop name/type still match the app, authors must stringify literals themselves); (2) `value` is narrowed to a string (the old `stat`'s `string|number|boolean|null` union is gone — lossy); (3) `format` is the app's `[compact,comma,none]` set, not `stat`'s `[number,percent,currency,raw]`; (4) no auto-shrink (no resize-observer / canvas text measurement) — `size` is applied as a fixed font-size.
- Not an input: writes nothing to the param store.
- Renders everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `value` | `string` | `""` | Static value to display when no `sql` is given. |
| `sql` | `string` | — | DuckDB SQL with `{{udf_name}}` and `$param_name` placeholders; returns first column of first row (highest priority over `value`). |
| `label` | `string` | — | Label text shown below the number. |
| `prefix` | `string` | `""` | Text prepended before the formatted number (e.g. `"$"`). |
| `suffix` | `string` | `""` | Text appended after the formatted number (e.g. `"%"`, `" km²"`). |
| `format` | `enum("compact","comma","none")` | `"compact"` | Number formatting: `compact` abbreviates (1.2M/45.3K/2.5B); `comma` adds thousand separators; `none` shows the raw value. |
| `decimals` | `number` | `1` | Decimal places used by `compact`/`comma` formatting. |
| `size` | `number` | `36` | Font size of the number in pixels. |
| `color` | `string` | — | Accent color for the number; inherits theme when absent. |
| `style` | `string` | — | Universal optional inline CSS declaration string; parsed and merged over the card defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads `columns[0]` of `rows[0]`, i.e. first column of first row).
- **Writes param:** no (`writesParam: false`).

## Notes
- Uses the `Card` ui-kit primitive as its container.
- The compact/comma/value formatting and first-cell resolution are ported from the app so formatted output matches; the first-cell read uses the same column-order-safe logic as the `text` sibling.
