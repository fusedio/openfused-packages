# `text-input`

> Text input with optional param sync (debounced); local input when no param.

## Why
A single-line text field — the canonical fan-out INPUT. An author reaches for it to let a human type a value that drives downstream data-bound nodes: typing broadcasts a string to the named `param` (debounced) so dependent `$param` SQL queries re-resolve. When no `param` is given it degrades to a plain local input that broadcasts nothing. Its ROLE is **input**. App-parity: a strict, paste-compatible SUBSET of the Fused application's `text-input` (identical prop names/types/semantics, fewer props — `submitMode` and the inline Submit button are omitted).

## Expectation
- Renders a `Field` (label + `htmlFor` wiring) wrapping a ui-kit `Input` (native `<input>`). `label` shows beside/above; `placeholder` shows while empty; `type` maps straight to the native input `type` (default `"text"`); `disabled` maps to the native `disabled`.
- The element `id` is synthesized from the `param` (falling back to a `"local"` token when no param) and used for both the `Input` `id` and the `Field` `htmlFor`.
- Host-state seam is the SDK hook `useFusedParamWithForm` (typed to a `string`, seeded from `defaultValue` with an empty-string fallback, broadcasting the default, and honoring the debounce). Outside a form it behaves like `useFusedParam`; inside a `form` it becomes local state mirrored into the form's field store for collective submit.
- **Two-way binding:** setting the value updates the local value instantly (responsive typing) and broadcasts to the param on a debounce, so dependent queries don't fire per keystroke. The input is fed a value that falls back to empty string (never an uncontrolled-input null).
- **INPUT value shape:** broadcasts a SCALAR `string` to `props.param`. Scalar — SAFE to reference in SQL as `$param` (text substitution).
- **Default seeding:** broadcasting the default seeds `defaultValue` into the param on mount IFF no canvas value already exists. Empty-string defaults are guarded internally by the SDK and never broadcast.
- **Debounce:** `debounceMs` when a number, else `300` (synthetic default; the prop is optional with no zod `.default`).
- **No-param mode:** with `param` omitted/empty the SDK hook explicitly degrades to plain local state (no broadcast); the field still works as a regular input.
- **Deliberate subset vs the app:** `submitMode` (type|focus|submit) is NOT reproduced — only the debounced "type" subset exists; a config with `submitMode=focus|submit` pastes without error but behaves as type-mode. The inline Submit button, draft/blur-commit state, and param-substitution of `$param`/`{{ref}}` references inside `defaultValue` are also out of scope. Form registration via `useFusedParamWithForm` IS reproduced. Legacy fused renames: `default → defaultValue`, `debounce → debounceMs`.
- Not data-bound: no `sql` prop, reads no result columns. Renders everywhere (no map/native-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | string | — | Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local input. |
| `label` | string | — | Label text displayed beside/above the input. |
| `placeholder` | string | — | Placeholder text shown while empty. |
| `defaultValue` | string | — | Initial value seeded into the param on mount. |
| `debounceMs` | number | — (300 applied at runtime) | Milliseconds to wait after typing before broadcasting the param (default 300). |
| `disabled` | boolean | — | Whether the input is disabled. |
| `type` | string | — ("text" applied at runtime) | HTML input type (e.g. "text", "email", "password"). |
| `style` | string | — | Inline CSS declaration string, parsed into a style object and merged over defaults; valid on every component. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `string` to `props.param`).

## Notes
- ui-kit primitive: the `Input` native field from ui-kit, wrapped by a label layout component that provides the label + `htmlFor` association and applies the parsed `style`.
- The component is registered through `defineComponent` (with `hasChildren: false`) and additionally flagged `writesParam: true` — that flag is appended outside `defineComponent` (the SDK does not know it); the generator surfaces it as the component's `isInput` flag in `components.json`.
- The `style → CSS` rename is applied globally by the shared universal-props definition; this file must NOT redeclare `style`. At render time the inline schema calls are no-ops — the real schema only matters to the agent-facing catalog the generator emits.
