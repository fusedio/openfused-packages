# `div`

> Container for grouping child elements; defaults to a flex column, fully style-driven.

## Why
`div` is the generic layout container — the author reaches for it to group, wrap, and arrange child nodes into a region of the widget. It is a pure CONTAINER (display only, no data, no input): it carries no own props and is styled entirely through the universal `style` string layered over a default flex-column. Use it to build rows/columns/cards/grids by overriding the defaults via `style`. It is a strict, paste-compatible SUBSET of the Fused application's `div` component (same type, same single own prop) — it renders identically to the app's container.

## Expectation
- Renders a single HTML `<div>`, then passes `element.children` through unchanged (the renderer has already walked the subtree). It is a `hasChildren: true` component.
- Default layout is a flex column that does not enforce a minimum content width (so children can shrink), matching the app's container.
- The author's `style` string (universal prop) is parsed into a property map and applied as the element's inline `style`, merging over / overriding the default flex-column layout.
- Not data-bound: it has no `sql` prop, reads no result columns, and triggers no resolver query stamping. No loading or error state.
- Not an input: it broadcasts nothing to the param store.
- No own props: the schema is `z.object({})` extended only with `UNIVERSAL_PROPS`, so `style` is the only authorable input. `required: []`.
- Renders everywhere (workspace, app, and the deployed self-contained bundle) — it needs no external resources.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `style` | `string` (optional) | — | Inline CSS styles as a plain CSS string; parsed into a property map and merged over the default flex-column layout. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- Default layout (a width-shrinkable flex column) lives in CSS, not in JS — fused deliberately avoids baseui / `@json-render/react`, so the app's flex-column container is reproduced as plain CSS.
- Authored only against `@fusedio/widget-sdk` (`defineComponent`, `ComponentRenderProps`, the style parser); reads the single `element` prop and accesses `element.props` (never spread).
- Children are rendered as-is via `element.children`; the renderer is responsible for walking the subtree before passing it down.
