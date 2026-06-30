# `gallery-input`

> Image-thumbnail gallery input; clicking a preset option writes its value to a param.

## Why
A single-select INPUT presented as a grid of image thumbnails: the author supplies a static list of `{value, src, label?}` options, the human clicks a card, and its `value` is broadcast to the param store (and highlighted). Reach for it when the choice is best made *visually* (picking a basemap, a colour ramp, a style preset) rather than from text labels. It is a config-compatible, behavioural SUBSET of the Fused application's `gallery-input`: identical prop names/types/semantics with fewer props.

## Expectation
- Renders a `Field` (label above) wrapping a `role="radiogroup"` flex grid that wraps (`flexWrap`, `gap: 12`). Each option is a `<button role="radio">` (fixed `width: 140`) containing an `<img>` (`height: 96`, `objectFit: cover`) over a single-line ellipsized `<span>` label.
- Options are sanitized before render: an option is dropped when `value == null`, or when the trimmed `value` is `""`, or when the trimmed `src` is `""`. `label` defaults to the trimmed `value` when absent/empty. `value`/`src`/`label` are coerced to strings.
- When no options survive sanitization, renders an in-card fallback `<div>No options available</div>` (font 13, grey) — it never blanks the widget.
- Selection highlight: the button whose `value === selected` (`value ?? ""`) gets a solid accent-coloured border + accent glow and `aria-checked={true}`; others are transparent-bordered. The highlight is applied with inline styles only, adding no new CSS classes.
- INPUT: binds via `useFusedParamWithForm`. It writes a **scalar string** (the clicked option's `value`) to the param store with no debounce — a click is a deliberate single action. Form-ready: defers broadcast inside a `Form`, behaves as `useFusedParam` outside one.
- Default seeding: `defaultValue` is seeded on mount **only** when it is a non-empty trimmed string; in that case it is passed through and broadcast. Empty/whitespace defaults are guarded (passed as `""`) and never broadcast. Note the author intent is that `defaultValue` match one option's `value`, but this is not enforced.
- The param is a scalar string, so it is SQL-safe to reference as `$param` (text substitution) — unlike array/object-valued inputs.
- Deliberate app subset: NOT data-bound. The app sources options from a DuckDB `sql` query (with `options` as fallback) and supports `mode` (horizontal/vertical/grid/carousel), `nullable`, `cardHeight`, `cardWidth`, `disabled`, and object-valued options; fused keeps the **static `options` path only**, renders one wrapping flex grid, and uses the option shape `{value, src, label}` (string values only) instead of the app's `{value, title, image}`. App-only props (`sql`, `mode`, `nullable`, `cardHeight`, `cardWidth`, `disabled`) are intentionally omitted; a pasted app config that sets them is ignored here.
- Renders everywhere (no map tiles / native-only dependency).

## Exposed params
| prop | type | default | description |
|---|---|---|---|
| `param` | `string` (optional) | — | Canvas parameter name to sync with, or form field name if inside a Form. |
| `label` | `string` (optional) | — | Label text displayed above the gallery. |
| `options` | `array<{value: string, src: string, label?: string}>` (optional) | — | Static options; each `{value, src, label?}`; options with an empty value are skipped. |
| `defaultValue` | `string` (optional) | — | Initial value when no canvas/form value exists; should match one option's value. |
| `style` | `string` (optional) | — | Universal: inline CSS declaration string, parsed and merged over defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar `string` — the selected option's `value` — to `props.param`).

## Notes
- Option sub-schema: `value` (string, required), `src` (string image URL or base64 data URL, required), `label` (string, optional; defaults to value).
- Uses the ui-kit `Field` primitive for label + `htmlFor` wiring, with a stable per-param element `id` derived from `param` (falling back to a local placeholder when unset).
- Config-compatible with the Fused application's `gallery-input` component.
