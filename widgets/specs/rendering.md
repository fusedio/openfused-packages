# `@fusedio/widgets` — render-time contract

How a config tree of `{type, props, children}` nodes becomes React. This is the
**render-time** contract owned by the package — the recursive walk, the `{element}`
prop contract, the `_queryId` binding, the host bridge components reach through, and
why zod is inert here. It is provider-neutral about *where* the config comes from: the
**consumer** render paths (the app fetching a config and POSTing it to its resolve
proxy; the deployed bundle host) are NOT owned here — see [Host render path](#host-render-path-not-owned-here).

---

## 1. The `{element}` contract

A renderable component is a `ComponentType<ComponentRenderProps>` from
`@fusedio/widget-sdk`. It receives **a single `element` prop** — `{ type, props,
children }` — and reads its config off `element.props`. The renderer **NEVER spreads**
the node onto the component.

- The renderer builds the element object per node as
  `{ type: node.type, props: node.props ?? {}, children: <recursively-rendered children> }`
  and invokes `<Component element={element} />`. `element.children` are the
  already-rendered React nodes, not raw config.
- Components reach host state **only** through SDK hooks (`useFusedParam` for inputs,
  `useDuckDbSqlQuery` for data, the template/style helpers for text) backed by a
  `FusedWidgetBridge`. No component touches the network, a DB, or a global store
  directly. The exhaustive authoring-side hook contract lives in
  [`internal-requirements.md`](./internal-requirements.md) §2.
- There is **no universal `visible` prop** / conditional-render gate — the Fused app
  has none, so Fused dropped it to keep configs a strict paste-compatible subset
  ([`internal-requirements.md`](./internal-requirements.md) §3,
  [`authoring.md`](./authoring.md)).

## 2. The walk: `RenderTree` / `RenderNode`

The package exports two render entry points (also re-exported from the barrel; see
[`surfaces.md`](./surfaces.md) §2):

- **`RenderTree({ config, bridge, children? })`** — wraps the whole tree in
  `<FusedWidgetBridgeContext.Provider value={bridge}>`, renders `config` via
  `RenderNode`, then renders any page-level `children` **under the same bridge**
  (e.g. the comments layer — [`comments.md`](./comments.md)).
- **`RenderNode({ node, path? })`** — renders one node. `path` defaults to `"0"` and
  is extended `"<base>.<i>"` per child, giving every node a stable address.

The walk is recursive and registry-driven:

1. **Malformed-node guard.** If `node` is falsy, non-object, or `node.type` is not a
   string, `RenderNode` returns the unknown-component placeholder — **never a throw**.
2. **Path marker.** Every node renders inside a wrapper that produces **no layout
   box** (so layout is identical to rendering the node directly) carrying the
   `data-ofw-node="<path>"` attribute. The marker holds the node's stable path for
   page-level comment anchoring (see [`comments.md`](./comments.md); detail also in
   `spec/ui/json-ui.md` §9).
3. **Registry lookup.** The `registry` keyed by `node.type` (derived once
   from `componentDefs` — [`catalog.md`](./catalog.md),
   [`internal-requirements.md`](./internal-requirements.md) §1). A miss renders a
   visible alert reading `unknown component: {type}`.
4. **Children.** Normalize `children` (null → `[]`, single node →
   one-element array) and recurse, keying each child by its path.
5. **Element + render.** Build the single `element` object (§1) and render
   `<Component element={element} />`.
6. **Query binding.** If the node carries a stamped `props._queryId` (non-empty
   string), wrap the rendered component in the query-id binding context provider (§3).

## 3. `_queryId` binding

A **data-bound node** is one the Python planner stamped with `props._queryId` (e.g.
`"q0"`). The renderer threads that id to the SDK data hook through a React context so
rows resolve by id, not by re-running SQL client-side:

- The binding wrapper provides the `queryId` through a React context. A node without
  `_queryId` renders with no provider (context default → `queryId: undefined`) and
  behaves as an unbound node.
- The component's `useDuckDbSqlQuery` reads the binding context, picks up the id, and
  threads it into the bridge's SQL query call. The static bridge resolves
  that id against the server-injected rows (§4) — it ignores the SQL text entirely.
- This is the port of the Fused application's query-id binding, done
  at render time only for stamped nodes rather than by wrapping every registered
  renderer.

The stamping itself, the `{{ref}}` / `$param` grammar, and the DuckDB resolution are
the **host's** contract — see [`authoring.md`](./authoring.md) (binding authoring view)
and host `spec/ui/data/data.md`.

## 4. The host bridge at render time

Components reach state **only** through `@fusedio/widget-sdk` hooks backed by a
`FusedWidgetBridge` read from `FusedWidgetBridgeContext`. The package ships a
mostly read-only static bridge for the standalone/native render. This is a
contract-level summary; the exhaustive invariants live in
[`internal-requirements.md`](./internal-requirements.md) §9 and the exports in
[`surfaces.md`](./surfaces.md) §4 — cross-link, don't duplicate.

- **Static bridge** (`createStaticBridge({ store, params })`). A `FusedWidgetBridge`
  whose `sql.query(_sql, opts)` is an async read through the data store —
  `await store.ensureFresh(opts?.queryId)` — and whose UDF queries are no-ops,
  `template.render` does best-effort local `$param` substitution, and
  `resolveVfsFilenames` returns a nominal filename for every requested ref (so the SDK
  preprocessing reaches `sql.query` instead of stalling, and an override-only `$param`
  change still changes `processedSql` and re-fires the query effect). The `params`
  sub-bridge is the *one* genuinely reactive piece.
- **Params store** (`createParamsStore`). A real in-memory reactive `Map` satisfying
  `FusedWidgetBridge["params"]` (`subscribe`/`getSnapshot`/`set`/`clear` +
  `subscribeMany`/`getSnapshotMany`), plus two session extras (`snapshotAll`,
  `subscribeAll`). An input's `set` notifies subscribers; `useFusedParam` siblings
  re-read via `getSnapshot`. There is no canvas/UDF re-execution — a bound-param change
  re-resolves the dependent queries server-side via the data store.
- **Data store** (`WidgetDataStore`). Holds resolver-produced rows keyed by `_queryId`,
  inverts the planner `depMap` (`param → [qid]` ⇒ `qid → [params]`), and additionally
  **tracks every query the config plans** — not just the param-driven ones that appear
  in `depMap` — via `collectConfigQueryIds` (a config walk mirroring the Python
  planner) or an explicit `queryIds` set (the canvas per-node store passes its OWN
  node's ids so it never resolves another node's queries). On a stale read
  (`ensureFresh`) it coalesces a **single-flight** POST to the widget-data endpoint:
  an in-flight fetch for the identical param snapshot is awaited (coalesce), a newer
  snapshot aborts the older one (supersede), and a stale response is dropped by a
  snapshot-identity guard. A query with **no resolved rows and no recorded error counts
  as stale**, so it resolves once on first paint even with no `$param` deps — this is
  what populates a **deployed** widget whose injected `data` was seeded empty (`{}`);
  the POST then carries `only: [<unresolved qids>]`. A per-qid error surfaces in-card
  and **never blanks the widget** (and an errored qid is not re-fetched on every
  render). The `await` is what keeps the SDK hook's `loading` flag true through a
  refetch. First paint is aligned with the server resolve by `harvestInitialParams`
  (pre-order harvest of input `param`/`defaultValue` + the `__comments` seed).
- **Action sink** (`ActionSinkContext`, `type ActionSink = (action, terminal) =>
  boolean | Promise<boolean>`). An optional host-provided press handler installed above
  `RenderTree`. When present it takes **precedence** over both the session and the
  parley routing: a `button` press routes to the sink and never touches the channel
  clients; a submit press locks into its submitted state only on a `true` return.
  Default `null` → the button falls through to the unchanged session/parley routing
  (and the MCP-Apps no-op posture when neither is active). See host
  `spec/ui/json-ui.md` §4.

## 5. zod is inert at render

Every component imports `z` to declare its prop schema at module load, but **no render
path ever `.parse()`s** with it — the schemas exist only for the build-time generator
([`catalog.md`](./catalog.md)).

- The render bundle aliases the bare `zod` specifier to a no-op `Proxy` stub that keeps
  the schema-declaration *syntax* valid (every call/property access returns a chainable
  callable proxy) while bundling nothing (~300 KB of zod stays out of `widget.html`).
  The stub is spread-safe and obeys the Proxy `ownKeys` invariant
  (see [`internal-requirements.md`](./internal-requirements.md) §7).
- The **only** runtime gate is `components.json` **type membership** — applied
  server-side by the host before the config is rendered. The renderer itself applies no
  prop validation: an unknown `type` degrades to the unknown-component placeholder; a
  known type renders with whatever props it was handed.

## 5a. Loading states — every data-bound display widget shows a skeleton

A data-bound widget is in one of four render states, surfaced by the SDK hook
(`useDuckDbSqlQuery` → `{ rows, loading, error }`) and the resolver's per-`queryId`
data/error maps:

- **loading** (query in flight, nothing resolved yet),
- **error** (the query failed — `ErrorState`),
- **empty** (resolved, zero rows — `EmptyState`),
- **ready** (rows in hand — the widget's own render).

**Requirement (normative): a display widget MUST render the shared skeleton while
loading — never a bare spinner, a `"Loading…"` string, or an empty box.** The shared
`SkeletonState` (`components/card.tsx`) is the single source of that look across the
catalog; it takes a `variant` shaped to the eventual content:

| variant | used by | shape |
|---|---|---|
| `chart` | bar / line / scatter / heatmap / stacked-area / stacked-bar / donut | a row of shimmer bars on a baseline |
| `table` | sql-table | a header bar + shimmer rows |
| `metric` | metric | a large value block + a small label block |
| `text` | text / markdown | shimmer lines of decreasing width |
| `block` | any other display widget | a single fill block |

The shimmer is one CSS animation (`.ofw-skeleton__shimmer` in `widget.css`) and is
disabled under `prefers-reduced-motion`. **Once a value has resolved, the widget keeps
showing it through a background re-resolve** (`loading` may flip true again) rather than
flashing back to the skeleton — the skeleton is a *first-paint* state, not a
re-fetch state (see `metric.tsx` / `text.tsx`).

**Input controls are the deliberate exception**: `dropdown` / `checkbox-group` keep an
inline `"Loading options…"` label (via `LoadingState`) instead of a skeleton — a
skeleton would hide the control the user is about to operate. Canvas nodes have their
own shape-matched `CanvasNodeSkeleton` ([`canvas.md`](./canvas.md)) for the initial
data-resolve; this section governs the in-card display widgets.

`SkeletonState` is a helper component, not a renderable json-ui `type`, so adding or
changing it does **not** require regenerating `components.json`.

## 5b. Shared code display & edit (`CodeBlock` / `CodeEditor`)

Two presentational helpers render source code with one consistent look across
every surface — the json-ui `markdown` widget's fenced blocks AND the consuming
app's code surfaces (UDF source, Explorer file previews, config snippets):

- **`CodeBlock`** (`components/CodeBlock.tsx`) — read-only highlighted code.
  Highlights with **shiki** (the `github-dark-default` theme, the JS regex
  engine — no wasm fetch) through a shared singleton highlighter; an optional
  left line-number gutter; and a plain-monospace `<pre>` fallback shown until
  the highlighter resolves, for unknown languages, and on error (never blank).
  `normalizeLang` maps a file extension, filename, or language name to a grammar
  id (null → no highlight).
- **`CodeEditor`** (`components/CodeEditor.tsx`) — the editable counterpart: a
  transparent `<textarea>` laid exactly over the same highlight layer (the
  react-simple-code-editor technique) so edits show live highlighting, with the
  gutter-matched padding that keeps the caret aligned when numbered. It is the
  *edit surface only* — the host owns save/concurrency (in flow via
  `InlineEditor`'s `renderEdit` hook, `spec/app/write-path.md` §1.5).

**shiki is imported lazily, inside the highlight effect — never at module
load** — so importing these (including transitively through `markdown-view`)
under node/tsx (the catalog generator) never pulls in the highlighter or its
grammars; the effect simply never runs there. Styling lives in `widget.css`
under `.ofw-code` (loaded globally by the host). Like `SkeletonState`, these are
helper components, **not** renderable json-ui `type`s, so they never affect
`components.json`.

`markdown-view`'s fenced code blocks render through `CodeBlock` (a `pre`
override on react-markdown); inline code is unchanged.

## 6. Host render path (NOT owned here)

The **consumer** flow — fetch the raw config, POST it once (no `only`) to the
widget-data resolve proxy to obtain `{data, errors, depMap, config}`, render the
**planned** tree (the resolver-stamped `config`, never the raw file), and re-resolve on
`$param` change — is the host's contract, not the package's. The package only provides
`RenderTree` + the bridge/store machinery the host wires together. See:

- the consuming control-plane app's native render + per-project resolve daemon (and its
  render path: first paint, reactivity, routing) now lives in fusedio/flow;
- host `spec/ui/data/data.md` — SQL resolution, the `{{ref}}`/`$param` grammar, the
  security boundary.

---

## Cross-references

- [`internal-requirements.md`](./internal-requirements.md) — the normative invariants
  (the `{element}` contract, the reactive data/param model, the zod-stub).
- [`surfaces.md`](./surfaces.md) — the package exports (`RenderTree`/`RenderNode`,
  the bridge/store/action-sink) and the generated `components.json`.
- [`authoring.md`](./authoring.md) — the config-document grammar, the binding authoring
  view, actions & selection.
- [`catalog.md`](./catalog.md) — the component catalog, single source of truth, and
  `components.json` generation (the hard type gate).
- [`comments.md`](./comments.md) — the comment overlay that consumes `[data-ofw-node]`.
- Host: the consumer render + resolve daemon now lives in fusedio/flow;
  `spec/ui/data/data.md` (SQL resolution + grammar + security boundary).
