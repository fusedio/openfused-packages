# `markdown`

> Render Markdown text — headings, lists, links, code, blockquotes, tables.

## Why
A dedicated Markdown renderer. Authors reach for it to surface prose, reports,
notes, or any GitHub-flavored markdown without hand-writing HTML. It is an
**OpenFused-owned primitive** (no app parity): the Fused application's `text`
component is a single-value display, and OpenFused's old markdown component was
retired into `text`. This brings markdown back as its **own type**, so `text`
stays a scalar display, `html` stays the raw-HTML escape hatch, and `markdown`
owns prose.

The rendering is the shared `MarkdownView` from `@fusedio/widgets`
(`src/markdown-view.tsx`) — the **same** renderer a consuming control-plane app's task thread
uses (that consumer is now external — Flow, `fusedio/flow`). One markdown implementation, two
surfaces.

## Expectation
- Renders a `.ofw-md` wrapper containing the parsed markdown. Parsing is
  `react-markdown` + `remark-gfm`, so GitHub-flavored extensions work: **tables**,
  ~~strikethrough~~, task lists, and autolinks, in addition to headings, lists,
  links, inline/block code, blockquotes, and horizontal rules.
- Links open in a new tab (`target="_blank" rel="noreferrer"`).
- **No raw HTML** is rendered (react-markdown default) — markdown only, matching
  the catalog trust model. Use the `html` widget when you need raw HTML.
- Styling is theme-portable: `.ofw-md` (widget.css) inherits the host's text
  `color` and sets only spacing/structure/translucent accents, so the same rules
  read on the dark widget card and the light/dark task thread of a consuming host.
- DATA-BOUND via the `sql` prop, mirroring `text`: first row / first column of the
  DuckDB result, coerced to string, rendered **as markdown**. The hook stays inert
  (`enabled: !!sql`) when no `sql` is authored.
- Render priority: **`sql` > `value`** (`sqlValue || value || ""`).
- Loading state: while `sql` is set AND the query is loading, the body is
  `"Loading..."`.
- `queryId` is read off `element.props._queryId` (resolver-stamped) and threaded
  into the hook.
- Not an input: writes no param.
- Renders everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `value` | `string` | `""` | Markdown source to render. Lower priority than `sql`. |
| `sql` | `string` | — | DuckDB SQL with `{{ref}}`/`$param`; first row / first column, coerced to string and rendered as markdown. Highest priority. |
| `style` | `string` | — | Optional inline CSS merged over `.ofw-md` defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → first row / first column, rendered as markdown).
- **Writes param:** no.

## Notes
- Uses SDK primitives only (`useDuckDbSqlQuery`, `parseStyle`, `defineComponent`,
  `ComponentRenderProps`) plus the shared `MarkdownView`. No ui-kit primitives.
- `MarkdownView` imports no CSS itself (the generator loads the widget catalog
  under node/tsx, which cannot parse CSS); consumers must have `widget.css`
  loaded — a consuming host loads it globally in its entry (`main.tsx`).
