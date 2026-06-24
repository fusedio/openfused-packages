# `slider`

> A slider that can optionally sync with canvas parameters. If param is provided, syncs with that parameter or form; otherwise works as a regular slider.

## Why
An INPUT component: a numeric range control that broadcasts a `Number` to the param store, letting a human steer a value that downstream data-bound nodes pick up via `$param` text substitution. The author reaches for it when a single bounded scalar (a threshold, year, radius, zoom) should drive other widgets or a UDF argument. Its role is **input**. App-parity status: a strict, paste-compatible SUBSET of the Fused application slider — identical type, prop names, types, and semantics, with fewer props (the app-only `disabled` is not implemented; an extra `disabled` key pastes in harmlessly and is ignored).

## Expectation
- Renders a `Field` wrapper containing an optional `label` row and the dumb `SliderRange` ui-kit primitive. When `label` is set, a row-style caption shows the label text on the left and the **live current value** on the right (mono, tabular). With no `label`, only the track renders.
- `SliderRange` drives the track fill from `value` and emits the new `Number` via `onValueChange` → `setValue(n)`.
- INPUT contract: writes a **scalar `number`** to `props.param`. Because it is a plain scalar, it is SQL-safe — it may be referenced in a data-bound node's `sql` as `$param` (text substitution).
- Param binding uses the form-aware hook `useFusedParamWithForm`, given the param name, the seed default, and a flag controlling whether the seed is broadcast:
  - Outside a `form`: two-way binds the named param exactly like `useFusedParam`.
  - Inside a `form`: becomes local state and mirrors its value into the form's field store for collective submit.
  - When `param` is undefined/empty: works as plain local state (per SDK contract).
- Seed semantics (`initIfAbsent`): `broadcastDefaultValue` is gated on `authoredDefault` — true ONLY when the raw `defaultValue` prop was actually present on the node. Zod's `.default(0)` makes the parsed value `0` even when omitted, so the seed is gated on the raw prop. Consequence: a slider WITHOUT an authored `defaultValue` reads the live param value but never broadcasts `0` into the param unintentionally; a slider WITH an authored `defaultValue` seeds it on mount iff the param has no existing canvas value. `seed` is `defaultValue` when numeric, else falls back to `min` (`lo`).
- Value coercion: `current` is the live value when already a `number`; if non-null/non-undefined/non-empty it is `Number(value)`; otherwise it falls back to `min` (`lo`). `min`/`max`/`step` fall back to `0`/`100`/`1` respectively if not numeric.
- The element carries a stable id derived from the param name (falling back to a "local" marker when no param is bound).
- Deliberate behavioural subset vs the app: the app uses a shadcn Slider with a 300ms debounce; openfused does NOT reproduce that heavy UI or the debounce — only the PROP CONTRACT and the param-write semantics match. The dumb control lives in `@kit` (`SliderRange`); this file is the thin param-binding wrapper.
- Renders everywhere (not native-app-only; no map dependency).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `label` | `string` | — | Label text displayed above the slider. |
| `param` | `string` | — | Canvas parameter name to sync with, or form field name if inside a Form. If omitted, works as a regular slider. |
| `min` | `number` | `0` | Minimum value. |
| `max` | `number` | `100` | Maximum value. |
| `step` | `number` | `1` | Increment between values. |
| `defaultValue` | `number` | `0` | Initial value seeded into the param on mount (seed broadcast only when the prop is authored). |
| `style` | `string` | — | Optional inline CSS declaration string parsed and merged over the component's defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `number` to `props.param`).

## Notes
- ui-kit primitive: `SliderRange` from `@kit` (dumb `value`/`onValueChange` control, no param store).
- Wrapper layout uses the shared field-wrapper component with no label of its own; the visible label row is rendered separately above the track.
- Wave-4 split (spec/ui/ui-architecture.md §6.2): the slider's bespoke component classes are replaced by the primitive plus utility classes.
