# `html`

> Raw-HTML escape hatch; the value is injected into the page DOM and any inline scripts execute. Trusted authors only.

## Why
`html` is a raw-HTML escape hatch: an author supplies a `value` string and the component injects it as live markup into the dashboard's DOM. Reach for it when no purpose-built component fits and you need arbitrary HTML (and, deliberately, executing inline `<script>`). ROLE: display. App-parity: a strict, paste-compatible SUBSET of the application's `html` component (identical prop name/type/semantics for `value`, fewer behaviours) — the openfused-legacy `content` prop is renamed to `value` to match the app.

## Expectation
- Renders a single `<div>` whose inline style comes from the parsed universal `style` prop. On mount and whenever `value` changes, the div's inner HTML is set to `value` (empty string when `value` is absent).
- Inline `<script>` execution: `<script>` nodes inserted via inner HTML are inert per the HTML spec, so after injection each `<script>` is re-created — a fresh script element copies every attribute and the text body, then replaces the original. This makes the browser run both inline scripts and `src=` scripts.
- Scripts share the dashboard's `window`/DOM (no isolation). For an isolated document, use the `iframe` component instead.
- NOT data-bound: there is no `sql` prop. The component reads `element.props.value` verbatim — no result columns are consumed.
- Deliberate behavioural subset vs the Fused app:
  - The app renders into a sandboxed iframe (`sandbox="allow-scripts"`, `srcDoc` + canvas-helper script) and relays iframe `postMessage` to the param `BroadcastChannel` for two-way `fusedCanvas.setParam/clearParam`; fused renders inline in the page DOM and exposes NO `fusedCanvas` bridge.
  - `$param_name` / `{{udf_name}}` substitution (the app's param-substitution step) is NOT reproduced — that SQL/param grammar is owned by the SDK/resolver layer, so fused reads `value` verbatim. A config using `$param`/`{{udf}}` or `fusedCanvas.setParam(...)` still pastes cleanly (same prop name `value`) but those bridges do not run here.
- Trust model: dashboards are trusted, locally-authored content (same trust model as the UDFs that produce them). Do not feed this remote or user-generated content.
- WHERE it renders: everywhere (not native-app-only; no map-tile dependency).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `value` | `string` | `""` | Raw HTML value. Supports `$param_name` placeholders and `{{udf_name}}` to inline HTML template or stringified UDF output (NOTE: those bridges are app-only and not reproduced in fused). |
| `style` | `string` | — | Optional inline CSS declaration string, parsed and merged over the component's defaults. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- The renderer is self-contained (no external helper component); it uses React `useRef` + `useEffect` and the SDK's style parser. Uses no ui-kit primitives.
- `value`'s describe text advertises `$param`/`{{udf}}` for app paste-compatibility, but fused injects the string verbatim — substitution does not occur here.
- `iframe` is the isolated-document alternative when script sandboxing is required.
