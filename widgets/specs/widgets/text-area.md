# `text-area`

> Multi-line text input with optional param sync (debounced); local text area when no param.

## Why
A fan-out INPUT control for free-form multi-line text. An author reaches for `text-area` to collect a paragraph, note, or query string from a human and feed it into the canvas param store (e.g. as a SQL `$param`), or — when no `param` is given — as a plain local textarea with no broadcast. It is the multi-line twin of a single-line text input. App-parity: a strict, paste-compatible SUBSET of the Fused application's `text-area` (identical prop names/types/semantics, fewer props).

## Expectation
- Renders a field wrapper carrying the optional `label` (placed above the control) and the parsed `style`, around the `@kit` `Textarea` primitive. The control gets `rows` (default `3`), `placeholder`, `disabled`, and the current value (empty string when unset); typing updates the value.
- INPUT behaviour: broadcasts a **scalar string** to the param store via the SDK's `useFusedParamWithForm`, seeding the param from `defaultValue` and broadcasting that default on mount. Setting the value updates the local value instantly for responsive typing and broadcasts the param on a debounce.
- Debounce: `debounceMs` defaults to `300` (used only when a numeric value is supplied; otherwise `300`).
- Default seeding: `defaultValue ?? ""` is the initial value; with `broadcastDefaultValue: true` it seeds the param on mount **iff no canvas value already exists** (empty-string defaults are guarded internally by the SDK).
- Form-aware: inside a `<Form>`, `useFusedParamWithForm` writes to the form's field store and DEFERS the broadcast until submit (treating `param` as the form field name); outside a form it behaves exactly like `useFusedParam`.
- No-param mode: when `param` is omitted it works as a regular local text area (no broadcast); the element gets a stable id derived from the param name (or a `"local"` suffix when there is none).
- SQL-safety: the value written is a scalar string, so it is safe to reference as `$param` in SQL (text substitution).
- Deliberate behavioural subset vs the Fused app — NOT reproduced: `submitMode` (type|focus|submit), `maxLength`, `readOnly`, the inline Submit button / draft-commit state, and `useParamSubstitution` on `defaultValue`. OpenFused implements the debounced "type" subset only.
- Not data-bound: there is no `sql` prop and no `_queryId`.
- Renders everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | `string` (optional) | — | Canvas parameter name to two-way sync with, or form field name inside a Form. If omitted, works as a regular local text area. |
| `label` | `string` (optional) | — | Label text displayed above the text area. |
| `placeholder` | `string` (optional) | — | Placeholder text shown while empty. |
| `defaultValue` | `string` (optional) | — | Initial value seeded into the param on mount. |
| `rows` | `number` (optional) | `3` (component-applied) | Number of visible text rows. |
| `debounceMs` | `number` (optional) | `300` (component-applied) | Milliseconds to wait after typing before broadcasting the param. |
| `disabled` | `boolean` (optional) | — | Whether the text area is disabled. |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over component defaults; universal prop. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `string` to `props.param` via `useFusedParamWithForm`).

## Notes
- `rows` and `debounceMs` defaults are applied in the component body (`rows = 3`; `debounceMs` coerced to `300` when non-numeric), not via zod `.default(...)` — the zod schema leaves both optional.
- ui-kit primitive: `@kit` `Textarea` (the dumb value/onChange control, no param store), per the §6.2 dumb-control / thin-binding split. The label/style chrome comes from the shared field wrapper.
- `style` is read off the node's `props.style` (the global `css → style` rename happens in the shared universal-prop layer); this file must NOT redeclare `style`.
