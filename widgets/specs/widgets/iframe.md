# `iframe`

> Embed an **external web page** (absolute http/https URL) in an iframe. `iframe` cannot call a local UDF — it only loads URLs.

## Why
`iframe` embeds an external web page inside the widget canvas. An author reaches for it to surface an existing deployed dashboard, doc, or HTTP endpoint without re-implementing it as native widgets. Its role is **display** (a non-interactive embed surface, no params). It is a strict, paste-compatible **subset of the Fused application's `iframe` component**: identical prop names/types/semantics, fewer props.

## ❌ Common mistake — do not use `iframe` to display a local UDF's output

`iframe` **cannot call a local UDF**. There is no `udf` prop. Passing `"udf": "my_udf"` is silently ignored and the missing `src` will render an error:

```json
// ❌ WRONG — "udf" is not a valid prop; this always shows an error placeholder
{ "type": "iframe", "props": { "udf": "my_udf" } }

// ❌ ALSO WRONG — {{udf}} placeholders are not resolved locally; same error
{ "type": "iframe", "props": { "src": "{{my_udf}}" } }
```

**✅ To display data from a local UDF, use native chart/table components with `sql`:**

```json
{ "type": "bar-chart", "props": { "sql": "SELECT label, value FROM {{my_udf}}" } }
{ "type": "sql-table", "props": { "sql": "SELECT * FROM {{my_udf}} LIMIT 100" } }
```

**✅ To embed HTML produced by a UDF**, deploy the UDF to Fused first and use its deployed URL:

```json
{ "type": "iframe", "props": { "src": "https://app.fused.io/server/default/udf/my_udf" } }
```

## Expectation
- Renders a single `<iframe>` element sized to fill its container (`width: 100%`, `height: 100%`, no border, block display), with the author's parsed `style` merged on top.
- Always carries a fixed `sandbox` attribute (`"allow-scripts allow-same-origin allow-forms allow-popups"`): the embedded page may script itself and talk to its own origin, but cannot navigate the top page, open modals, or trigger downloads. This is not author-configurable (no `sandbox` prop).
- `title` attribute is `props.title` if set, else the literal `"embedded content"`. `allow` attribute is passed through verbatim from `props.allow` (undefined when omitted).
- **Src safety gate:** `src` is validated before use — it must parse as a `URL` with protocol `http:` or `https:`. Any other scheme (`javascript:`, `data:`, `blob:`, `file:`) or an unparseable string (including an unresolved `{{udf}}` placeholder) is rejected, and the component renders an inline error placeholder reading `"iframe src must be an absolute http(s) URL"` (with the parsed `style` applied). The error is in-card; it never blanks the widget or runs script in the bundle's own context.
- **Not data-bound:** there is no `sql` prop; the component never reads result columns and is never resolver-stamped with `_queryId`.
- **Deliberate behavioural subset vs the Fused app:** the `src` string is used **as-is** — fused does NOT reproduce `$param` URL interpolation or `{{udf}}` placeholder resolution (run-udf, blob URLs, share tokens). The prop *describes* those grammars for paste-compatibility, but an unresolved `{{udf}}` src fails the URL parse and shows the blocked placeholder. The app's loading `Spinner` and X-Frame-Options handling are also not reproduced. The app's `content` / `height` / `sandbox` props are intentionally not declared (the app's own schema has none either).
- Renders **everywhere** (no native-app-only restriction; not a map widget).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `src` | `string` (required) | — | Absolute http(s) URL, optionally with `$param` references, or an exact UDF placeholder like `{{udf}}` / `{{udf?name=$param}}`; the iframe source (used as-is — placeholders are not resolved by fused). |
| `title` | `string` (optional) | — | Accessible title for the embedded content → iframe `title` attribute (falls back to `"embedded content"`). |
| `allow` | `string` (optional) | — | Optional Permissions-Policy `allow` attribute (e.g. `camera; microphone; geolocation`). |
| `style` | `string` (optional) | — | Universal prop: inline CSS declaration string, parsed and merged over the component's default iframe styles. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- `hasChildren: false` — `iframe` is a leaf node.
- The src protocol check is the load-bearing guard; the fixed sandbox attribute value mirrors the app's own default sandbox (hardening from PR #79 review).
- Authored entirely against `@fusedio/widget-sdk` (`defineComponent`); reads the single `element` prop via `element.props` and never spreads `element`.
