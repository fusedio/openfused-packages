# `datetime-input`

> Date, time, or datetime input with optional param sync (debounced); local input when no param.

## Why
A fan-out INPUT control for capturing a date, a time, or a local datetime from the human and broadcasting it (as a string) to the canvas param store, so other data-bound nodes can react to it via `$param`. The author reaches for it to drive date/time filters or range pickers; with no `param` it degrades to a plain local input. ROLE: input. It is a strict, paste-compatible SUBSET of the Fused application's `datetime-input` (identical prop names/types/semantics, fewer props — `step`, `readOnly`, the popover Calendar picker, and `useParamSubstitution` on `defaultValue` are intentionally not reproduced).

## Expectation
- Renders a card-style input shell holding an optional `<label>` and a single native `<input>`. The input carries a stable id derived from `param` (falling back to a `"local"` suffix when no param), and the `label` is wired to that id so clicking the label focuses the input.
- The native input `type` is derived from `mode`: `date` → `"date"`, `time` → `"time"`, `datetime` → `"datetime-local"`. `mode` defaults to `"date"`.
- Value is a plain string stored WITHOUT timezone conversion (matching the app): `date` is `YYYY-MM-DD`, `time` is `HH:mm`, `datetime` is `YYYY-MM-DDTHH:mm`. `min`/`max` are passed straight to the native input. `disabled` toggles the native disabled state.
- INPUT contract: binds via `useFusedParamWithForm<string>({ param, defaultValue: defaultValue ?? "", broadcastDefaultValue: true, debounceMs: 300 })`. It broadcasts a SCALAR STRING to `props.param`. Because the value is scalar, it is safe to reference as `$param` (text substitution) in another node's SQL.
- Default/initial-value seeding: `broadcastDefaultValue: true` seeds `defaultValue` into the param on mount IFF no canvas value already exists. `defaultValue` falls back to `""` when unset; the rendered input shows `value ?? ""`.
- Debounce: writes are debounced 300 ms before broadcast (`debounceMs: 300`).
- Form-ready: inside a `Form`, `useFusedParamWithForm` defers the broadcast to form submit (Form-aware twin of `useFusedParam`).
- No `param`: works as a regular local datetime input (still two-way bound through the hook, using the `"local"` id suffix).
- Deliberate behavioural subset vs the Fused app: fused uses the NATIVE date/time/datetime-local input across all three modes (no popover Calendar picker), omits `step` and `readOnly`, and does NOT run `useParamSubstitution` on `defaultValue`.
- WHERE it renders: everywhere (not a map widget; no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | string | — | Canvas parameter name to two-way sync with, or form field name inside a Form; if omitted, works as a local datetime input. |
| `label` | string | — | Label text displayed above the input. |
| `defaultValue` | string | — | Initial string value seeded into the param on mount. |
| `mode` | enum(`date`, `time`, `datetime`) | `"date"` (component-side fallback; schema has no `.default`) | Input mode: `date`→`YYYY-MM-DD`, `time`→`HH:mm`, `datetime`→`YYYY-MM-DDTHH:mm`. |
| `min` | string | — | Minimum allowed date, time, or datetime string. |
| `max` | string | — | Maximum allowed date, time, or datetime string. |
| `disabled` | boolean | — | Whether the input is disabled. |
| `style` | string | — | Optional inline CSS declaration string, parsed and merged over the component's default styles. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar string to `props.param`).

## Notes
- `mode` has no zod `.default(...)`; the `"date"` default is applied in the component via destructuring (`mode = "date"`), so an omitted `mode` resolves to date both at render and as documented.
- Uses the shared card-style input shell (the same primitive as `select`/`slider`/`text-input`) and the standard ui-kit input styling. The `style` prop is parsed and applied to that shell.
- The single `element` prop is read, never spread; `style` is read off `element.props` directly (the universal `css → style` rename is handled by the shared universal-props layer, so this component does not redeclare it).
