# `checkbox-group`

> Multi-select checkbox set that writes the chosen option values to a param as an ARRAY; options may be static ({value, label}) or sourced from a DuckDB SQL query returning value/label columns. Optional min/max selection bounds.

## Why
A multi-select input — the array twin of `dropdown`. The human ticks zero or more of N choices and the chosen `value`s are broadcast to the param store as an **array**, the human's reply channel for "pick any of these" asks. The author reaches for it whenever a question allows more than one answer: multi-select questions in an agent-authored `ask_user` widget. It is the only json-ui input that writes a non-scalar value by design.

Its ROLE is **input**. App-parity status: this is an OpenFused-owned feedback input with **no Fused application equivalent** — the application's only selection input is `dropdown` (single-select), and its multi-select facet is `sql-table`'s row-selection extension, not a standalone checkbox set. `checkbox-group` therefore aligns its prop names/semantics to OpenFused's own `dropdown` conventions (the closest sibling), NOT to an app component. Because it writes an array param it is, like `sql-table`'s `selectionParam` and `video-review`, an OpenFused feedback primitive whose array param **must never be referenced in SQL** (`$param` is text substitution; only scalars are SQL-safe — `spec/json-ui-data.md`).

## Expectation
- Renders a Field shell (`label` above) wrapping a vertical list of checkbox rows. Each resolved option is one row — a `<label>` pairing an `@kit` checkbox control (the dumb checked/onChange primitive, §6.2 dumb-control / thin-binding split) with the option's `label` text. Clicking a row toggles that option's `value` in/out of the selection set.
- **Data-bound:** the `sql` prop carries DuckDB SQL. Rows are normalized by NAMED columns — `value`/`Value`/`VALUE` and `label`/`Label`/`LABEL` (case-insensitive); `label` falls back to `value`; values are `String(...).trim()`-ed and rows with empty/null value are dropped. **This is the identical normalization as `dropdown`** (reuse `normalizeSqlRow`).
- **Option precedence:** `sql` takes precedence over `options` — but only when it yields rows. On SQL error OR empty rows, falls back to the static `options` list (the same precedence as `dropdown`). With no `sql`, uses `options` directly.
- **Static options:** sanitized via the same rules as `dropdown` — entries with empty/null `value` dropped, `value` trimmed, `label` defaults to the trimmed value.
- **INPUT contract:** writes an **ARRAY** of selected option `value` strings to `props.param` via `useFusedParam<string[]>` (the raw param hook — NOT `useFusedParamWithForm`, which constrains the value to `string | number` and so cannot hold an array). This mirrors `sql-table`'s `selectionParam` exactly: `defaultValue: []`, `broadcastDefaultValue: false` so the param is untouched until the first interaction (or the `defaultSelected` seed below). The cleared state is the empty array `[]`. Selection order is preserve-on-toggle: a newly ticked value is appended; un-ticking removes it.
- **Default seeding:** `defaultSelected` (an array of option `value`s) is broadcast on mount only when non-empty, seeding the param iff no canvas value already exists (the array analogue of `dropdown`'s `defaultValue` seeding). An empty/absent `defaultSelected` leaves the param at `[]` and broadcasts nothing on mount. Unlike `dropdown` there is **no first-option auto-select** and no `nullable` — a multi-select's natural empty state is "none ticked", so nothing is auto-selected.
- **Bounds (`minSelected` / `maxSelected`):** OPTIONAL advisory selection bounds. `minSelected` (default `0`) and `maxSelected` (default unbounded) are surfaced for the human and gate a paired submit `button` *at the host*, exactly as the native `ConfirmCard` did (`violatesCheckboxBounds`): the server is the authority, the bound is a UX guard that avoids a guaranteed-reject round-trip. `checkbox-group` itself does **not** own a submit button (a paired `button action submit:true` settles the session), so the component's own responsibility is: (a) render the bound as helper text when `minSelected > 0` or `maxSelected != null` (e.g. "Select 1–3"); (b) when `maxSelected` is set and reached, render the unticked rows disabled so the human cannot exceed it. The min bound is purely advisory at the component (it cannot block a button it does not own) — the host wires it to the submit per the card-forms mapping. Do not silently drop a selection to satisfy a bound.
- **Loading state:** while `sql` is loading, the rows are disabled and a "Loading options…" indicator renders below (reuse the shared `LoadingState`, as `dropdown` does).
- **Disabled:** the whole group is disabled when `disabled` is true OR while loading; individual rows additionally disable when `maxSelected` is reached (above).
- **Self-reference guard:** if `sql` references its own `param` (detected via `extractSqlParams`), the query is not run — the same render-time defensive guard `dropdown` carries (a valid config never references the param it writes, so it cannot break a pasted config).
- **Error fallback:** a SQL error never blanks the widget — it silently falls back to static `options` (as `dropdown`).
- **Where it renders:** everywhere (no native-app-only restriction); ships no heavy deps.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `label` | `string` (optional) | — | Label text displayed above the checkbox group. |
| `param` | `string` (optional) | — | Canvas parameter name to sync with; receives the selection as an ARRAY of chosen option `value`s. If omitted, works as a regular non-broadcasting checkbox group. |
| `sql` | `string` (optional) | — | DuckDB SQL returning rows with NAMED `value`/`label` columns; takes precedence over options; must not reference its own param. |
| `options` | `array<{value: string, label?: string}>` (optional) | — | Static option list used when sql is absent or fails; `label` defaults to `value`. |
| `defaultSelected` | `array<string>` (optional) | — | Option `value`s ticked on mount; seeded into the param iff no canvas value exists (broadcast only when non-empty). |
| `minSelected` | `number` (optional) | `0` | Advisory minimum selection count; rendered as helper text and wired to a paired submit button at the host (the server is the authority). |
| `maxSelected` | `number` (optional) | — (unbounded) | Advisory maximum selection count; when reached, unticked rows render disabled. |
| `disabled` | `boolean` (optional) | — | Whether the whole group is disabled. |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over component defaults; universal prop. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads named `value`/`label` columns, case-insensitive; falls back to static `options` on error/empty — identical to `dropdown`).
- **Writes param:** yes (`writesParam: true`; broadcasts an ARRAY of selected option `value`s to `props.param`; cleared state is `[]`).

## Notes
- Renders via ui-kit (`@kit`) checkbox + the shared label/field shell; the loading indicator reuses the shared card `LoadingState` (mirror `dropdown`).
- SQL options are sourced via `useDuckDbSqlQuery` (host pre-resolves; the component only paints). Reuse `dropdown`'s `sanitizeStaticOptions` / `normalizeSqlRow` (factor them shared if convenient; the contract is intentionally identical).
- Param binding via `useFusedParam<string[]>` — **not** `useFusedParamWithForm` (the array value cannot pass through the `string | number` constraint). The write pattern is `sql-table`'s `selectionParam` verbatim (`defaultValue: []`, `broadcastDefaultValue: false`, `Array.isArray(value) ? value : []` on read). This means `checkbox-group` is **not** form-bundle-aware in v1 (it writes its own param directly, like `sql-table`'s selection) — acceptable because the card forms it replaces submit through a paired `button`, not a `form`.
- The control gets a stable DOM `id` derived from `param` (falling back to `"field"`) so the field label links to the group, matching `dropdown`/`text-area`.
- Self-reference detection scans the SQL for param references via `extractSqlParams`; all SDK helpers (`useDuckDbSqlQuery`, `useFusedParam`, `parseStyle`, `extractSqlParams`, `defineComponent`) come from `@fusedio/widget-sdk`.
- `style` is read off `props.style` (the universal-prop layer owns the `css → style` rename); this file must NOT redeclare `style`.
