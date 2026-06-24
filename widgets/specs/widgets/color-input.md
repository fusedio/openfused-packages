# `color-input`

> Color input with optional param sync (debounced); local color input when no param.

## Why
A swatch field for picking a single color: it renders a native `<input type="color">` and writes the chosen `"#rrggbb"` hex string to the param store, debounced. It is an INPUT (fan-out) component — reach for it when an author wants a color chosen by the human to drive downstream SQL/UDFs through a named `param`, or simply as a self-contained local picker when `param` is omitted. It is Form-ready: inside a `Form` the broadcast defers to submit. Its prop contract is a strict, paste-compatible SUBSET of the Fused application's `color-input` (identical prop names/types/semantics, fewer props) — except `showValue`, an openfused-local convenience.

## Expectation
- Renders a `Field` (label + control) wrapping a flex row: a native `<input type="color">` swatch, optionally followed by a monospace span showing the hex string when `showValue` is set.
- The control value is the bound hex string, falling back to `"#000000"` when unset; changing the swatch updates the bound value. `disabled` maps straight onto the native input.
- INPUT value shape: broadcasts a **scalar string** (the `"#rrggbb"` hex) to the param store via `useFusedParamWithForm`. Scalar, so it is SQL-safe to reference as `$param` (text substitution).
- Seeding: the hook seeds `defaultValue` (falling back to `"#000000"`) on mount **iff** no canvas value already exists for the param. Broadcast is debounced (~100ms); inside a `Form` the broadcast defers to submit.
- `param` is OPTIONAL: when omitted, the component works as a regular **local** color input (no canvas sync). The control gets a stable `id` derived from `param` (or a local fallback when `param` is omitted).
- The universal `style` is read off the node's props, parsed from its CSS declaration string, and applied to the `Field` wrapper.
- NOT data-bound: there is no `sql` prop and the component reads no result columns.
- Deliberate behavioural subset vs the Fused app: app-only machinery is intentionally out of scope — `format` (rgb/hsl/hsb), `showAlpha`, `readOnly`, and the full popover ColorPicker (area/hue/alpha/eyedropper) + color-string parsing. openfused uses the native hex input and broadcasts only the `"#rrggbb"` string.
- Renders everywhere (no native-app-only restriction; not a map widget).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | `string` (optional) | — | Canvas parameter name to two-way sync with, or form field name if inside a Form; omit for a regular local color input. |
| `label` | `string` (optional) | — | Label text displayed above the color input. |
| `defaultValue` | `string` (optional) | — | Initial hex color value seeded into the param (e.g. `"#E8FF59"`). |
| `showValue` | `boolean` (optional) | — | Whether to render the hex string next to the swatch. |
| `disabled` | `boolean` (optional) | — | Whether the picker is disabled. |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over the component's defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `"#rrggbb"` hex string to `props.param`).

## Notes
- Host-state seam is the SDK's `useFusedParamWithForm` (the Form-aware twin of `useFusedParam`): it exposes the two-way canvas binding and seeds `defaultValue` on mount only when no canvas value exists.
- Uses the ui-kit/local `Field` primitive for the label + control layout.
- `showValue` is openfused-local (not app parity); the app instead shows the value in its picker trigger and uses `format`/`showAlpha` (out of scope here).
