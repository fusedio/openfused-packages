# `iframe`

> Embed a web page or HTML-returning UDF in an iframe using http(s) URLs, $param URL templates, or {{udf}} placeholders.

## Why
`iframe` embeds an external web page (or the HTML output of a UDF) inside the widget canvas. An author reaches for it to surface an existing dashboard, doc, or HTML-returning endpoint without re-implementing it as native widgets. Its role is **display** (a non-interactive embed surface, no params). It is a strict, paste-compatible **subset of the Fused application's `iframe` component**: identical prop names/types/semantics, fewer props.

## Expectation
- Renders a single `<iframe>` element sized to fill its container (`width: 100%`, `height: 100%`, no border, block display), with the author's parsed `style` merged on top.
- Always carries a fixed `sandbox` attribute (`"allow-scripts allow-same-origin allow-forms allow-popups"`): the embedded page may script itself and talk to its own origin, but cannot navigate the top page, open modals, or trigger downloads. This is not author-configurable (no `sandbox` prop).
- `title` attribute is `props.title` if set, else the literal `"embedded content"`. `allow` attribute is passed through verbatim from `props.allow` (undefined when omitted).
- **Src safety gate:** `src` is validated before use — it must parse as a `URL` with protocol `http:` or `https:`. Any other scheme (`javascript:`, `data:`, `blob:`, `file:`) or an unparseable string (including an unresolved `{{udf}}` placeholder) is rejected, and the component renders an inline error placeholder reading `"iframe src must be an absolute http(s) URL"` (with the parsed `style` applied). The error is in-card; it never blanks the widget or runs script in the bundle's own context.
- **Not data-bound:** there is no `sql` prop; the component never reads result columns and is never resolver-stamped with `_queryId`.
- **Deliberate behavioural subset vs the Fused app:** the `src` string is used **as-is** — openfused does NOT reproduce `$param` URL interpolation or `{{udf}}` placeholder resolution (run-udf, blob URLs, share tokens). The prop *describes* those grammars for paste-compatibility, but an unresolved `{{udf}}` src fails the URL parse and shows the blocked placeholder. The app's loading `Spinner` and X-Frame-Options handling are also not reproduced. The app's `content` / `height` / `sandbox` props are intentionally not declared (the app's own schema has none either).
- Renders **everywhere** (no native-app-only restriction; not a map widget).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `src` | `string` (required) | — | Absolute http(s) URL, optionally with `$param` references, or an exact UDF placeholder like `{{udf}}` / `{{udf?name=$param}}`; the iframe source (used as-is — placeholders are not resolved by openfused). |
| `title` | `string` (optional) | — | Accessible title for the embedded content → iframe `title` attribute (falls back to `"embedded content"`). |
| `allow` | `string` (optional) | — | Optional Permissions-Policy `allow` attribute (e.g. `camera; microphone; geolocation`). |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and merged over the component's default iframe styles. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- `hasChildren: false` — `iframe` is a leaf node.
- The src protocol check is the load-bearing guard; the fixed sandbox attribute value mirrors the app's own default sandbox (hardening from PR #79 review).
- Authored entirely against `@fusedio/widget-sdk` (`defineComponent`); reads the single `element` prop via `element.props` and never spreads `element`.
