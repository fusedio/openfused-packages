# `@fusedio/widgets` — the canvas rendering surface

The **canvas** is the package's free-form layout render layer: one registered widget
(`type: "canvas"`) whose `props.nodes[]` each carry a normal `{type,props,children}` widget
subtree, laid out on a ReactFlow surface where an **edge** — not mere co-residence — is what
makes one node's `$param` visible to another. It is a faithful re-port of the Fused
application's MCP-host canvas, reshaped onto this package's renderer; the config contract is
**PINNED to app parity**, layout and chrome are **FREE**.

> One sentence: a `canvas` is one JSON-UI node placed on a ReactFlow graph, where each node
> renders its widget subtree through this package's own [`RenderNode`](./rendering.md) under
> an edge-gated per-node bridge, and the human's edits mirror back to the agent.

This spec is the **rendering half** only. The **host** half — teaching the Python planner to
descend into `props.nodes[].widget` to discover queries, stamp `_queryId`s, and fold them
into the global depMap — stays in [`spec/ui/data/canvas.md`](../../../spec/ui/data/canvas.md)
§5 and is **not** absorbed here. The split is hard: edge-gating is entirely client-side; the
server resolver still just resolves SQL given a params dict.

---

## 1. The config contract (PINNED — app parity)

A canvas is a JSON-UI node `{ "type": "canvas", "props": { ... } }`. Content lives in
`props.nodes`, **not** `children`; the renderer treats `canvas` as a leaf (`hasChildren:
false`) and the canvas compiles each node's `widget` subtree itself.

```jsonc
{
  "type": "canvas",
  "props": {
    "nodes": [                                   // REQUIRED, >= 1
      {
        "id": "sales",                           // author-defined, unique; routing + React key
        "widget": { "type": "metric", "props": { "sql": "..." } },  // a normal {type,props,children} subtree
        "position": { "x": 0, "y": 0 },          // optional → auto-layout when omitted
        "size": { "width": 320, "height": 180 }, // optional → content-estimated from the widget
        "title": "Sales",                        // optional node-card header
        "description": "…",                      // optional one-line; surfaced on hover with the title
        "layer": "data"                          // optional: "data" | "transform" | "view" (auto-layout column hint)
      }
    ],
    "edges": [                                    // optional
      { "source": "region_picker", "target": "sales", "directional": true }
    ],
    "folders": [                                  // optional, layout-only grouping
      { "id": "kpis", "nodeIds": ["sales", "units"], "title": "KPIs", "collapsed": false }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 },    // optional; pins pan/zoom (suppresses fit-on-load)
    // auto-layout knobs (FREE; default to prior behaviour):
    "layout": "dtv",                              // "dtv" (default) | "dag"
    "folderBands": "vertical",                    // "vertical" (default) | "horizontal"
    // chrome (FREE):
    "background": "dots",                         // "dots" | "lines" | "none"
    "showControls": true,
    "fitViewPadding": 0.1,
    // comments (json-ui-comments.md):
    "comments": [ … ],                            // seed for the canvas-level __comments param
    "enableComments": true                        // default true
  }
}
```

`CanvasPropsSchema` is the build-time source of truth: an inert zod-stub stands in for `zod`
in the render bundle, while real zod is used under the generator for the agent catalog. The
config TS types are `z.input` of it, so `.default()` fields stay optional, matching authored
config. `editable` / `allow*Nodes` props are **present + validated but inert** in this pass
(read-only render; edit behaviour is a later pass).

**Validation** (parses the config into a normalized `ParsedCanvas`), ported from the app:

- `nodes[].id` unique; a duplicate is dropped (first wins) and recorded in `errors`.
- Edges referencing a missing node (`dangling`), self-edges, and duplicate edges (in **either**
  direction — deduped by unordered pair) are dropped with a `console.warn`.
- `edgeConnectionKeys`: an O(1) `Set<"source->target">` derived once.
- Folders are flat single-level; a node belongs to at most one folder; folders and nodes
  **share one id-space** (a folder id colliding with a node id is rejected to `errors`).
- `edge.directional` defaults `true`; `folder.collapsed` defaults `false`.
- `folderBands` falls back to `"vertical"` for any value other than the explicit
  `"horizontal"`; `layout` falls back to `"dtv"` for any value other than `"dag"` (so an
  absent/unknown value is byte-identical to the prior behaviour).

`node.widget` is any valid JSON-UI subtree from the [catalog](./catalog.md). A `canvas`
nested **inside** a canvas node is not supported. Config errors do not blank the canvas — they
render in a non-blocking `role="alert"` banner over the surface.

---

## 2. The registered widget (PINNED + FREE)

The canvas registers as a thin shim via `defineComponent` with `hasChildren: false` and
`writesParam: false` (the canvas itself never writes a param). It renders `CanvasRenderer`,
which mounts the canvas surface inside a `<ReactFlowProvider>`.

The canvas stylesheet (which `@import`s `@xyflow/react`'s base styles) is **deliberately not
imported** by the registration shim — the generator evaluates this module under tsx/node and
cannot load CSS. The side-effect import lives in the bundle entry, so esbuild still folds it
into the `widget.html` bundle while the generator never sees it.

`@xyflow/react` is the canvas's one new runtime dep and is admitted on the widget package's
import allowlist; see [internal-requirements.md](./internal-requirements.md).

---

## 3. Host integration — the `CanvasHostContext` seam (PINNED)

This package's renderer hands a widget only its `element` (the SDK `{type,props,children}`
contract). A canvas node additionally needs the host data plane to build per-node data
stores, so the package exposes a minimal context the **consumer** publishes around the render
tree:

`CanvasHostContext` / `useCanvasHost()` / `CanvasHostValue` carries:

| field | role |
|---|---|
| `config` | the full canvas config — POSTed back so the resolver re-stamps the same `_queryId`s |
| `data`, `errors`, `depMap` | the host's pre-resolved rows / errors / `param→[queryId]` map |
| `resolveUrl` | the widget-data POST endpoint the host already uses |
| `dataLoading?` | opt-in (pipeline overview): first resolve still in flight → data-bound nodes show a skeleton |
| `disableNodeFullscreen?` | opt-in (overview canvas): hide each node's maximize button |
| `feedbackMode?`, `onComment?`, `onCommentsChange?`, `onRequestCommentMode?`, `commentsDisabled?` | the host-driven comment/feedback hooks (see [comments.md](./comments.md)) |

The consumer publishes it: both the standalone bundle host and the app re-publish
`{config, data, errors, depMap, resolveUrl}` on `CanvasHostContext.Provider` around the
`RenderTree`. This is the cleanest seam — the renderer hands a widget only its element, so the
canvas re-publishes the host data plane on a context its own nodes read. The reactive flow it
plugs into is specified in [rendering.md](./rendering.md) (the static bridge + `WidgetDataStore`).

---

## 4. Edge-gated routing — the CLIENT/render semantics (PINNED)

Widgets read/write params by **name** through the SDK bridge, unchanged. The canvas makes a
param visible to a *reader* node only through an edge. Edge-gating is **entirely
client-side** — the server depMap stays global; the client decides which params reach which
node and POSTs per-node `only`-subset resolves.

**Allowed sources** (the per-node allowed-source set, memoized per id; ported from the app and
reduced to a single routing key per node):

> Node N's allowed sources = **N itself** + the source of every edge *incoming* to N +
> the target of every **bidirectional** (`directional:false`) edge *outgoing* from N.
> Deduped, self first.

**The source-tagged param store** replaces the flat `Map<name,value>` for canvas subtrees.
State shape:

```ts
{ [param]: { [originId]: { value, originId, originName, updatedAt } } }
```

- `set(param, value, originId, updatedAt)` tags a write with the writing node's id and a
  stamp, then notifies that param's subscribers.
- `getSnapshotFiltered(param, allowedOriginIds)` returns, among the allowed origins that have
  set `param`, the value with the **max `updatedAt`** (most-recent-wins); `undefined` if none.
- Per-param subscriber sets; `notify` iterates a copy so a callback that (un)subscribes
  mid-notify can't break iteration.

**The per-node bridge** is a thin view over the host base bridge + the store: it **delegates**
every node-agnostic capability (`sql`, `template`, `signUrl`, `log`, uploads, udfs) to the
base bridge, and **overrides** `node`, `params`, `edges` so reads filter to this node's allowed
sources (most-recent-wins) and writes are tagged with this node's id as origin. `params.set`
keeps the SDK's 3rd `ParameterMessageType` arg so `useFusedParam` calls it unchanged (the store
ignores the type — source-tagging + recency gate routing, not the type).

**The per-node data store**: each node gets its own `WidgetDataStore` whose depMap is restricted
to that node's own `_queryId`s (the query ids collected from its widget subtree) and is backed
by the gated param snapshot. So a SQL widget re-resolves only for params its edges allow, and
node B never re-resolves node D's queries. A param change re-resolves only the queries of nodes
whose edges admit that param's origin — by POSTing `{config, params: <node's gated snapshot>,
only: <node queryIds>}` to the same `resolveUrl`. The runtime reads the parsed node ids/widgets,
**never** the layout output — positions are irrelevant to routing, and rebuilding on a collapse
toggle would re-resolve all node data.

**Default seeding (PINNED):** each node's own widget defaults are seeded per-origin under that
node's id at `updatedAt: 0`, so defaults are edge-gated exactly like user values and a real
user set always supersedes. The renderer carries the store forward across input refreshes (it
passes the previous store into the rebuilt runtime) so param state survives while per-node data
stores rebuild.

**Folders are invisible to routing** — purely organizational.

### 4a. Feedback mirror — canvas inputs reach the agent (PINNED)

Edge-gating governs node-to-node **reads**; it must not trap a human's edits away from the
watching agent. So a per-node bridge **write** does two things:

> `set(param, value)` → (1) `store.set(param, value, nodeId, now)` — the edge-gated,
> source-tagged write for routing; **and** (2) `base.params.set(param, value)` — mirrored to
> the **page-level** params store so the session/parley reporter emits it to `widget watch`,
> exactly as a flat-widget input does. (`clear` mirrors the same way.)

This is feedback-only and side-effect-free for resolution: the page-level `WidgetDataStore` is
**lazy** (re-resolves on `sql.query`, never on a param subscription), and on a canvas nothing
queries the page bridge — node SQL runs through the per-node gated stores. Node defaults are
seeded into the *canvas* store (not the page store), so inputs don't broadcast on mount — only
genuine user edits mirror, no load-time feedback noise. The mirrored snapshot is flat
(last-write-wins across origins); edge-gating is unchanged for reads. See
[`spec/ui/data/canvas.md`](../../../spec/ui/data/canvas.md) §3b for the full feedback rationale.

---

## 5. Auto-layout, folder bands, node scroll (FREE)

Position-less nodes are auto-arranged; authored positions always win. Heights come from a
**deterministic content estimate**, not a runtime measure — charts render asynchronously, so
measuring at mount races the chart and under-spaces the column (tall chart nodes would overlap).
An authored `size` fixes the box exactly; otherwise the node is width-bounded (per-type estimate)
and content-sized in height.

- **`layout`** — `"dtv"` (default) lays nodes into layered Data→Transform→View columns:
  column = pipeline depth (longest-path from a source), clamped by `node.layer`; a node's
  layer is explicit → edge topology (in/out-degree) → widget-type tiebreak. A tall rank wraps
  into 2–3 balanced sub-columns. `"dag"` runs a dagre directed-graph layout (`@dagrejs/dagre`,
  `rankdir: "LR"`, `ranksep` 160 / `nodesep` 56) driven by the real edges, with each node
  pinned to its DTV layer via three hidden zero-size rank anchors so disconnected nodes spread
  Data→Transform→View instead of all collapsing into column 0. A mixed canvas (some authored,
  some auto) nudges auto nodes right to clear authored rectangles.
- **`folderBands`** — when folders are present, `"vertical"` (default) stacks the regions
  top→bottom; `"horizontal"` lays them left→right (matching the DTV/DAG flow). In `dag` mode
  the folder boxes are derived from their members' placed bounds (no band stacking). A
  derived folder region is bounded to its members' bounding box + padding; an authored
  folder position/size wins.
- **Conditional node scroll** — a node clips to its box. A `ResizeObserver` on the node body
  measures overflow; when content exceeds the box the body becomes scrollable and captures the
  wheel (the wheel scrolls the node, not the canvas) and pointer events (so a display node
  scrolls). A node whose content fits is unchanged — a display node stays transparent to canvas
  pan/zoom (drag/wheel over it pans/zooms the canvas; the user is never stuck on a node). Only
  nodes containing an interactive control (`slider`/`dropdown`/inputs/`button`/`form`) capture
  drag + real pointer events.

### 5a. Folder collapse — interactive view state (FREE shape, PINNED dataflow)

Folders collapse/expand **live by the viewer** (clicking a folder title bar), beyond the
authored `collapsed` flag.

- **Ephemeral**: live collapse toggles are held only in transient renderer state — they reset
  on the next agent push / re-render and are never persisted; the authored `collapsed` stays the
  source of truth; overrides are invalidated wholesale when the folder id-set changes.
- **Dataflow invariant (PINNED — the hard-won rule):** collapse is a **drawing concern
  only**. Hidden members stay **mounted** but visually hidden and non-interactive — they are
  NOT filtered out of the ReactFlow node array. Folder members are often param *sources*
  (dropdowns/sliders); unmounting them drops their broadcast params and every downstream query
  re-resolves empty (the whole canvas blanks). Edges incident to a hidden member are not drawn
  (visual only).
- **Chrome:** the title bar is a real `<button>` (disclosure chevron, label, `(N)` member
  count when collapsed; `aria-expanded`); the collapsed region shows hidden members as quiet
  name chips (max 4 then `+N`) and is itself click-to-expand.

Comment pins anchored to a hidden member hide with it — see [comments.md](./comments.md).

---

## 6. Surface chrome, fit, and fullscreen (FREE)

The canvas renders a full-size relative-positioned surface (with a `min-height: 640` floor) and
an absolutely-positioned inset child so ReactFlow's full-height layout resolves even under an
auto-height ancestor. ReactFlow is mounted **read-only**: `nodesDraggable=false`,
`nodesConnectable=false`, `elementsSelectable=false`, `edgesFocusable=false`; interactive
widgets inside nodes still work via the interactive-control gate (§5).

- **Background**: `dots` / `lines` / `none`. PINNED guard — render *no* pattern until the
  viewport transform is finite and `zoom > 0` (an unmeasured container makes ReactFlow compute
  `x % (gap*zoom)` against NaN/∞ and emit thousands of SVG errors per second).
- **Controls**: a glass zoom/fit cluster (no minimap, no whole-canvas fullscreen), gated by
  `showControls`.
- **Fit-on-load**: when no `viewport` is pinned, the canvas fits all nodes once
  `useNodesInitialized()` reports every node measured (a single rAF is not enough — node
  dimensions resolve asynchronously, later still in a late-sizing flex container; fitting
  before that strands nodes off-screen). A `ResizeObserver` also re-fits exactly once on the
  0 → real container-size transition (late-sizing parents like the app's full-bleed pipeline
  tab). A re-fit fires on every node-set change (keyed on the node-id signature) — the initial
  load and every push that adds/removes nodes — but never on comment- or param-only changes,
  preserving a manual pan. The fit animates (ease-out 600ms; instant under
  `prefers-reduced-motion`).
- **Node fullscreen**: a node's maximize button expands its widget to fill the viewport
  (portalled above the surface) under the **same** per-node bridge, so params still flow.
  Suppressed when the host sets `disableNodeFullscreen`. A node going hidden (collapse) closes
  its fullscreen.
- **Param-flow pulse**: a node mid-broadcast is tracked as a running source for ~800ms; it
  drives the source node's animation and animates its outgoing edges as a transient flow pulse.

---

## 7. Full-bleed when the canvas is the ROOT (a CONSUMER concern)

A canvas is a whiteboard, not a document: when the **root** config node is a `canvas`, the
page renders **full-bleed** — the bounded document frame is dropped and the ReactFlow surface
fills the whole viewport. This is decided by the **host/consumer**, not this package: the host
keys it off `config.type === "canvas"`, sets a body attribute (`data-ofw-canvas-root`) its
stylesheet frees the page root against, and wraps the canvas in a flex fill (in both the
standalone bundle host and the app's widget-detail / pipeline views). A **nested** canvas — a
`canvas` node among others on a non-canvas root — is **not** full-bleed: it stays bounded by its
container, falling back to the surface's `min-height` floor. The package's only contribution is
the surface's `min-height: 640` floor; the page-frame decision lives in the consumers.

This is the canonical example of the host/package split: the package renders a bounded
surface; the consumer decides how that surface is framed in the page. See
[`spec/ui/data/canvas.md`](../../../spec/ui/data/canvas.md) §3c.

---

## 8. The comment overlay on a canvas root

Figma-style pinned comment threads on canvas nodes ride the canvas-level `__comments` param.
The canvas owns its own overlay (flow-coordinate pins, node-anchored positioning, the
comment-mode toggle / `C`/`Esc` keys, the host feedback hooks). The full rendering surface —
the data layer, the overlay, pin anchoring/hit-testing, and the agent feedback loop — is
specified in **[comments.md](./comments.md)**. `CanvasPropsSchema` gains `comments` (seed) +
`enableComments` (default on); `enableComments` is forced off when the host sets
`commentsDisabled`.

---

## 9. Build / artifacts

- `@xyflow/react` + `@dagrejs/dagre` are the canvas's runtime deps; the import-guard admits
  them for the canvas modules (see [internal-requirements.md](./internal-requirements.md)).
- The component-registry catalog carries the one-line `canvas` entry (key == json-ui type).
- The generator emits the `canvas` entry into [`components.json`](./surfaces.md) — the hard
  type gate Python reads at runtime; a CI freshness check proves the artifact is current.
- The canvas renderer ships inside the `widget.html` bundle (built from the bundle host +
  `@fusedio/ui-kit`), which is the deploy-serve + parley/`widget open` renderer, **not** an
  MCP resource. `@xyflow/react` is sizable — the bundle has a CI size budget; the canvas is
  imported statically (no code-splitting), so ReactFlow ships in the one bundle.

---

## Cross-references

- **Render-time `{element}` contract, registry, `_queryId` binding, the static bridge +
  reactive `WidgetDataStore` flow** — [rendering.md](./rendering.md).
- **The comment overlay (data layer, pins, feedback loop)** — [comments.md](./comments.md).
- **The component catalog** node widgets draw from — [catalog.md](./catalog.md).
- **Package exports (`CanvasRenderer`, `CanvasHostContext`) + generated `components.json`** —
  [surfaces.md](./surfaces.md).
- **Package invariants (import allowlist, zod-stub, build-time/runtime split)** —
  [internal-requirements.md](./internal-requirements.md).
- **HOST half (NOT in this package):** the planner descending into `props.nodes[].widget`, the
  global depMap, the per-node `only`-subset resolve route, and the behavioural rationale for
  edge-gating / feedback-mirror / full-bleed — [`spec/ui/data/canvas.md`](../../../spec/ui/data/canvas.md).
