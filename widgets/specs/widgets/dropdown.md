# `dropdown`

> Dropdown that writes the chosen option value to a param; options may be static ({value, label}) or sourced from a DuckDB SQL query returning value/label columns.

## Why
A single-select control that lets the human pick one option and broadcasts the chosen value to the param store, parameterizing downstream data-bound nodes. The author reaches for it to drive a `$param` filter (region, category, date bucket) from either a fixed list of choices or a dynamically-resolved one. Its ROLE is **input**. App-parity status: this is the Fused `select` renamed/re-aligned to the Fused application `dropdown` component — its prop contract is a strict, paste-compatible SUBSET of the app's `dropdown` (identical names/types/semantics, fewer props).

## Expectation
- Renders a Field shell (`label` above) wrapping ui-kit's Radix `Select` (`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`); each resolved option becomes a `SelectItem` keyed by its `value`, displaying its `label`.
- **Data-bound:** the `sql` prop carries DuckDB SQL. Rows are normalized by NAMED columns — `value`/`Value`/`VALUE` and `label`/`Label`/`LABEL` (case-insensitive); `label` falls back to `value`; values are `String(...).trim()`-ed and rows with empty/null value are dropped.
- **Option precedence:** `sql` takes precedence over `options` — but only when it yields rows. On SQL error OR empty rows, falls back to the static `options` list (app precedence). With no `sql`, uses `options` directly.
- **Static options:** sanitized via the same rules — entries with empty/null `value` dropped, `value` trimmed, `label` defaults to the trimmed value.
- **INPUT contract:** writes a SCALAR string (the selected option `value`) to `props.param` via `useFusedParamWithForm<string>`. The cleared/no-selection state is the empty string `""` (not null) since `useFusedParamWithForm` constrains the value to `string | number`. Because it writes a scalar string, the param is SQL-safe to reference as `$param`. Inside a `form` it mirrors its value into the form-field store for collective submit.
- **Default seeding:** `defaultValue` is broadcast on mount only when non-empty; empty-string defaults are guarded by the SDK and never broadcast. A non-empty `defaultValue` absent from the resolved list is prepended as a synthetic `{value, label}` option so the store and widget never disagree.
- **First-option auto-select:** when there is no `defaultValue` and `nullable` is falsy, an effect seeds the param with the first resolved option (once options are loaded and the param is still empty); `nullable: true` leaves the param cleared/null.
- **Loading state:** while `sql` is loading, the control is disabled, the placeholder reads `"Loading…"`, and a "Loading options…" indicator renders below.
- **Placeholder:** when nothing is selected, shows `placeholder ?? "Select an option..."` via Radix `SelectValue` (Radix forbids a `value=""` item, so the no-selection sentinel `""` is passed as `undefined` to surface the placeholder).
- **Disabled:** the control is disabled when `disabled` is true OR while loading.
- **Self-reference guard:** if `sql` references its own `param` (detected by scanning the SQL for param references), the query is not run — a render-time defensive guard with no app prop equivalent; a valid app config never legitimately references the param it writes, so it cannot break a pasted config.
- **Error fallback:** a SQL error never blanks the widget — it silently falls back to static `options`.
- **Deliberate subset vs the app:** `options` keeps only the `{value, label?}` object form (no bare scalars); `defaultValue` is narrowed to `string` (was the app's broader default rename); `param` is OPTIONAL (omitting it makes the control a plain non-broadcasting dropdown).
- WHERE it renders: everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `label` | `string` (optional) | — | Label text displayed above the dropdown. |
| `param` | `string` (optional) | — | Canvas parameter name to sync with, or form field name inside a Form; if omitted, works as a regular dropdown. |
| `sql` | `string` (optional) | — | DuckDB SQL returning rows with NAMED `value`/`label` columns; takes precedence over options; must not reference its own param. |
| `options` | `array<{value: string, label?: string}>` (optional) | — | Static option list used when sql is absent or fails; `label` defaults to `value`. |
| `placeholder` | `string` (optional) | — | Placeholder text shown when nothing is selected. |
| `defaultValue` | `string` (optional) | — | Initial value when no canvas/form value exists; prepended as a synthetic option if absent from the loaded list. |
| `disabled` | `boolean` (optional) | — | Whether the dropdown control is disabled. |
| `nullable` | `boolean` (optional) | — | If true, no option is auto-selected when defaultValue is absent (param starts cleared/null); if false, the first option is auto-selected. |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over the component's default styles. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads named `value`/`label` columns, case-insensitive; falls back to static `options` on error/empty).
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar string — the selected option `value` — to `props.param`; cleared state is `""`).

## Notes
- Renders via ui-kit (`@kit`) Radix `Select` primitives wrapped in the shared label/field shell; the loading indicator reuses the shared card loading element.
- SQL options are sourced via `useDuckDbSqlQuery` (host pre-resolves; the component only paints). Param binding via `useFusedParamWithForm`; self-reference detection scans the SQL for param references — all from `@fusedio/widget-sdk`.
- The control gets a stable DOM `id` derived from `param` (falling back to `"field"`) so the field label's `htmlFor` links to the trigger.
