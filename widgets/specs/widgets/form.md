# `form`

> Form container that collects its descendant inputs and broadcasts them ON SUBMIT. With a top-level param, all fields are bundled into one JSON object on that param; without one, each field broadcasts to its own param. Renders its own submit button (submitLabel). Submit-to-apply: dependent queries re-resolve after submit, not live while typing.

## Why
`form` is a CONTAINER that batches its descendant inputs and broadcasts their values to the param store ON SUBMIT instead of on every keystroke. Authors reach for it to group several fields (text-input, dropdown, slider, …) and apply them atomically — so dependent data-bound widgets re-resolve once, after submit, rather than per-keystroke. It is a config-level subset of the Fused application's `form` component (identical `param`/`submitLabel` names, types, and semantics), with one deliberate behavioural narrowing: fused has no client-side DuckDB, so in-form edits cannot re-query live and instead apply on submit. Role: container.

## Expectation
- Renders a form container laid out as a flex column, then its `element.children`, then its OWN trailing submit button captioned `submitLabel || "Submit"`. The author's `style` string is parsed into inline styles and merged OVER the default container styles.
- Creates ONE per-Form params store (kept in a ref, never recreated) and provides a form context (carrying the store and an in-form flag) to its subtree. The context value is memoized on the store so the subtree does not churn on Form re-render.
- Descendant inputs authored with `useFusedParamWithForm` detect the form context: while inside a form they become pure LOCAL state (they do NOT broadcast to the canvas) and mirror their live value into the form's params store.
- On submit it reads the collected field values and broadcasts through the widget bridge's params:
  - When `param` is a non-empty string: bundles ALL fields into ONE JSON object and sets `param` to its JSON string — a single param carrying `{ name: "...", city: "..." }`. (Note: as JSON-stringified text, this param is not safely usable as a scalar `$param` in SQL.)
  - When `param` is absent/empty: broadcasts each field to its OWN param, skipping any empty field name. This preserves the application's top-level-`param` gotcha byte-for-byte.
- `form` itself is NOT an input: it declares a `param` but NO `defaultValue`, does not two-way bind a single param, and is `writesParam: false` (so the generator's param+defaultValue lint is not triggered). The param writes happen imperatively through the bridge on submit, not via `useFusedParam`.
- Submit-to-apply timing: field edits stay local until submit; pressing submit broadcasts and the normal reactivity path re-resolves dependent server-side queries. Same config and final result as the app, different timing.
- Behavioural subset vs the Fused app: (1) no live in-form re-query on edit (submit-to-apply, forced by server-side-only SQL); (2) fused's `button` widget is the feedback-session reply primitive and writes nothing to params, so it cannot drive submit — the Form renders its OWN submit button. A pasted app config that relied on a child submit button still renders; fused just owns the submit affordance.
- Not data-bound (no `sql` prop); renders everywhere.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | string (optional) | — | If set, on submit all child field values are bundled into a single JSON object and broadcast to this one param; if omitted, each child field broadcasts to its own param individually. |
| `submitLabel` | string (optional) | — (falls back to `"Submit"` at render) | Text for the form's submit button. Default "Submit". |
| `style` | string (optional) | — | Inline CSS declaration string, parsed and merged over the default flex-column container styles. |

- **Data-bound:** no.
- **Writes param:** yes, but `writesParam: false` — `form` is a container, not a tracked input. It does not two-way bind a single param; instead, ON SUBMIT it imperatively writes to the param store via the widget bridge — either bundling all fields as one JSON object on `props.param`, or broadcasting each field to its own param when `param` is absent.

## Notes
- The form's machinery is shipped by `@fusedio/widget-sdk`: the per-Form params store, the form context, the widget bridge, the in-form param hook `useFusedParamWithForm` (used by descendant inputs), and the inline-style parser.
- Reuses the existing primary-button styling; the container is styled inline (no new shared CSS). The submit button sits at the start of the column with a small top gap.
- The top-level-`param` JSON bundle is text, not a scalar — do not reference it as `$param` in SQL; address individual fields by giving each child input its own param and omitting the form-level `param`.
