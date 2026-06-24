# `number-input`

> Numeric input with optional param sync (debounced); local number input when no param.

## Why
A fan-out INPUT control for collecting a single numeric value from the human and broadcasting it to the canvas param store, where data-bound nodes can read it as `$param` inside SQL. The author reaches for it when a numeric knob (threshold, count, radius, year, …) should drive other widgets reactively, or — when no `param` is set — as a plain local number field. Its role is **input**. App-parity: a strict, paste-compatible SUBSET of the Fused application's `number-input` (identical prop names/types/semantics, fewer props); `readOnly`, range `validate`/`preprocess` guards, and the `min<=max` refine are intentionally not reproduced.

## Expectation
- Renders a `<input type="number">` (via the ui-kit `Input` primitive) wrapped in a `Field` that paints the optional `label` above the control and applies the parsed `style` string to the field container.
- **Input value shape:** writes a **scalar number** to the param. The broadcast value is always coerced to a number from the raw input string, so the param holds a number, not a string. Because the value is scalar it is SQL-safe — it may be referenced as `$param` (text substitution) in data-bound nodes.
- **Param binding:** via `useFusedParamWithForm` (typed `number`), seeded with the prop `param`/`defaultValue`, broadcasting the default value on mount and debouncing broadcasts by 300ms. Broadcasts are **debounced 300ms**. Inside a `Form` the broadcast defers to submit (`param` doubles as the form field name); outside a form it behaves as plain `useFusedParam`.
- **Default seeding:** broadcasting the default value seeds the initial value on mount **iff no canvas value already exists**. The hook is given `defaultValue` when it is a number, else falls back to `0` (a synthetic numeric default so the param is always numeric).
- **Draft buffer (NaN guard):** while editing, the raw string is held in local draft state; the param broadcast only fires when the raw string is non-empty and parses to a finite number. So clearing the field, or typing transient fragments like `"-"` or `"1."`, never broadcasts a `NaN` param (an empty string parses to `NaN`, covering the empty case). On **blur** the draft is dropped so the field re-syncs to the canonical (possibly externally-updated) numeric value.
- **Display:** shows the draft while editing; otherwise the param `value` stringified when it is a finite number; otherwise empty string.
- `min`, `max`, `step`, `placeholder`, `disabled` are mapped straight onto the native `<input type="number">`; `step` defaults to `1`. Range enforcement relies entirely on the native input's `min`/`max`/`step` (no JS-side refine).
- The control derives a stable element id from `param` (falling back to a local marker when unset), wiring the `Input` `id` and `Field` `htmlFor` together.
- `param` is OPTIONAL: with no `param` the widget is a self-contained local number field with no canvas broadcast.
- Renders **everywhere** (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | `string` | — | Canvas parameter name to two-way sync with, or form field name inside a Form; omit for a local-only number input. |
| `label` | `string` | — | Label text displayed above the number input. |
| `placeholder` | `string` | — | Placeholder text shown while empty. |
| `defaultValue` | `number` | — | Initial numeric value seeded into the param on mount. |
| `min` | `number` | — | Minimum allowed value. |
| `max` | `number` | — | Maximum allowed value. |
| `step` | `number` | `1` | Step increment (default applied in the component, not the zod schema). |
| `disabled` | `boolean` | — | Whether the input is disabled. |
| `style` | `string` | — | Optional inline CSS declaration string, merged over the field's defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `number` to `props.param`, debounced 300ms).

## Notes
- Per `spec/ui/ui-architecture.md` §6.2 the widget is split into the dumb shared `Input` primitive from `@kit` (`@fusedio/ui-kit`) plus this thin param-binding wrapper that owns the `defineComponent` declaration and the `useFusedParamWithForm` host-state seam. The leaf `<input type="number">` renders through the kit primitive.
- The label/container chrome comes from the shared `Field` component.
- `step`'s `1` default is applied in the component body, not the zod schema, so the schema carries no default — `_meta`/catalog reports `step` as an optional `number` with no schema default.
