# `canvas`

> A free-form canvas: each widget is a node, wired by edges that carry param dataflow. A $param set by an input in one node is only seen by a component in another node if an edge connects them. Place widgets in props.nodes[].widget (a normal json-ui config), not in a children array.

## Why
`canvas` lays a set of widgets out as a free-form ReactFlow graph: each entry in `props.nodes[]` holds one self-contained json-ui widget config (its `widget` subtree), and `props.edges[]` wire nodes together to gate param dataflow. It is a CONTAINER, but a non-standard one — it does NOT use the SDK `children` array (`hasChildren: false`); content lives in `nodes[].widget`. Reach for it to present a multi-node "pipeline" view (Data → Transform → View) where an input in one node should feed a query in another only along an explicit edge. It is an OpenFused-OWNED primitive (not governed by app parity), ported from the app's mcp-host canvas; the canvas itself never writes a param (`writesParam: false`).

## Expectation
- Renders a read-only ReactFlow surface (`CanvasRenderer` over a ReactFlow provider). View mode only: node dragging, node connecting, element selection, and edge focus are all off; structure is read-only.
- Each `nodes[]` entry becomes a `json-ui` ReactFlow node (an openfused `RenderNode`), rendered under an edge-gated per-node bridge from the canvas runtime so each node POSTs to the SAME host resolve URL. The canvas reads its data plane (config/data/errors/depMap/resolve URL, plus host flags) from `CanvasHostContext`, published by the bundle host — NOT from the SDK `element` (the renderer hands a widget only its `element`).
- Node sizing: an authored `nodes[].size` fixes the box exactly; otherwise width is a per-type estimate and height is a deterministic content estimate computed up front (NOT a runtime measure — measuring races async charts and under-spaces the column).
- Layout: position-less nodes are auto-arranged by `layout` — `"dtv"` (default) into layered Data→Transform→View columns, or `"dag"` (dagre LR). Authored `position` nodes keep their coordinates under either mode. `layer` is a per-node DTV column hint.
- Edges animate while their source node is mid-broadcast: a node is marked running on start-of-load and clears after an 800ms settle pulse, driving edge + node "flow" animation.
- Folders (`folders[]`) are organizational regions only — they NEVER affect dataflow (routing is edge-gated alone). A collapsed folder renders as a summary bar; its member nodes stay MOUNTED but hidden from view (so param-source nodes keep broadcasting — unmounting them blanks downstream queries), and incident edges are dropped from drawing only. Clicking a folder title bar toggles an EPHEMERAL collapse override (view state; resets on the next push, never persisted — authored `collapsed` stays the source of truth).
- Viewport: `viewport` pins initial pan/zoom; absent, the canvas fits all nodes into view on load (padded by `fitViewPadding`, capped at zoom 1, ease-out 600ms tween, instant under `prefers-reduced-motion`). Re-fits on every node-set change (keyed on node-id signature) unless `viewport` is pinned; gated on ReactFlow node-initialization plus a one-shot resize observation for late-sizing flex containers.
- First-load spinner: a node shows the spinner only when the host signals data is loading AND the node's widget subtree is data-bound (carries any non-empty `props.sql`); static cards never spin.
- Comments overlay (`json-ui-comments.md`): ON BY DEFAULT — gated by `enableComments !== false` AND the host not disabling comments. `C` toggles comment mode, `Esc` exits (ignored while typing in INPUT/TEXTAREA/contentEditable). Comment threads are carried on the reserved canvas-level `__comments` param; `props.comments` SEEDS that param. In host feedback mode, each newly-added comment fans into the feedback task thread; the full array persists on every commit.
- Per-node fullscreen: a node can expand to fill the viewport (rendered under the same per-node bridge so params still flow); suppressed when the host disables node fullscreen.
- Config validation: drops duplicate node ids (→ recorded error), self-edges / dangling edges / duplicate edges (unordered-pair dedupe; warned), folder ids that collide with a node id or duplicate (→ recorded error), and dangling / already-owned folder members (warned). Edge id defaults to `"${source}->${target}"`; `directional` defaults `true`. Recorded errors render an in-surface "Canvas configuration issue" banner — they never blank the canvas.
- Routing (contract §3): a node N sees param values from itself + the source of every incoming edge + the target of every outgoing edge whose `directional` is `false` (bidirectional). A node IS its own routing key (its `id`).
- Edit-control props (`editable`, `allowMoveNodes`, `allowResizeNodes`, `allowConnectNodes`, `allowAddNodes`, `allowDeleteNodes`) are present + validated only ("Pass 1"); the renderer is hard read-only and does not yet honor them ("behaviour is Pass 2").
- Renders EVERYWHERE (no native-app-only restriction); ReactFlow ships inlined in the one esbuild bundle. (A canvas node may itself host a map widget, which carries its own deployed-bundle placeholder.)

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `nodes` | `array<{id, widget, position?, size?, title?, description?, layer?}>` | — | The widgets placed on the canvas. Each node holds one json-ui widget config in `widget` (NOT a children array). `id` is the stable routing key; `position`/`size` optional (prefer omitting — auto-layout + content-size); `layer` is a `data`/`transform`/`view` DTV column hint. |
| `comments` | `array<CanvasComment>` | — | Pinned comment threads (json-ui-comments.md). Seeds the canvas-level `__comments` param; an agent reads open threads off the parley and bakes the updated array back here on its next push. |
| `enableComments` | `boolean` | `true` | Whether the canvas shows the comment-mode toggle and renders comment pins/threads. Set false to hide comments. |
| `edges` | `array<{source, target, id?, directional?}>` | — (no edges) | Connections that carry param dataflow source→target (incoming edges feed; outgoing bidirectional edges also feed). `directional` defaults true; `id` defaults to `"${source}->${target}"`. |
| `viewport` | `{x, y, zoom}` | — | Initial pan/zoom. If absent, the canvas fits all nodes into view on load. |
| `folders` | `array<{id, nodeIds, title?, position?, size?, color?, collapsed?}>` | — | Optional titled regions that visually group nodes. Organizational only — never changes which params a node sees. `color` is a decorative hue key; `collapsed` defaults false. |
| `folderBands` | `enum("vertical", "horizontal")` | `"vertical"` | How position-less (derived) folder regions are arranged: vertical stacks top→bottom, horizontal lays them side-by-side. Only affects folders without an authored position/size. |
| `layout` | `enum("dtv", "dag")` | `"dtv"` | Auto-layout for position-less nodes: `dtv` = layered Data→Transform→View columns; `dag` = dagre directed-graph (LR) driven by edges. Authored-position nodes keep their coordinates either way. |
| `showControls` | `boolean` | `true` | Show the zoom / fit-view controls. |
| `background` | `enum("dots", "lines", "none")` | `"dots"` | Canvas background pattern. |
| `fitViewPadding` | `number` | `0.1` | Padding used when fitting all nodes into view on load. |
| `editable` | `boolean` | `false` | Master edit switch (Pass 1: validated only). When false the canvas is read-only; when true the user can edit, subject to the per-capability flags. |
| `allowMoveNodes` | `boolean` | `true` | When editable, drag nodes to reposition (Pass 1: validated only). |
| `allowResizeNodes` | `boolean` | `true` | When editable, resize nodes (Pass 1: validated only). |
| `allowConnectNodes` | `boolean` | `true` | When editable, draw dataflow edges between nodes (Pass 1: validated only). |
| `allowAddNodes` | `boolean` | `true` | When editable, add new widget nodes from the palette (Pass 1: validated only). |
| `allowDeleteNodes` | `boolean` | `true` | When editable, delete nodes and their incident edges (Pass 1: validated only). |
| `style` | `string` | — | Universal prop: optional inline CSS declaration string, merged over the component's defaults. |

- **Data-bound:** no (the canvas itself carries no `sql`; data-binding lives inside each `nodes[].widget` subtree, resolved per-node through the host `resolveUrl`).
- **Writes param:** no (`writesParam: false`; the canvas never broadcasts a param. Note: it SEEDS — but does not author-write via `useFusedParam` — the reserved canvas-level `__comments` param from `props.comments`, an `array<CanvasComment>` carried over parley/URL-sync; this comment array must never be referenced in SQL `$param` text substitution).

## Notes
- A thin registration shim wires the canvas into the component catalog; the React layer is split across the render surface, config validation, the routing helper (§3), the build-time zod schema (the `CanvasProps` source of truth, with comment/edge/folder/viewport sub-schemas), and the per-concern node/edge/folder/comment/controls/background/fullscreen/sizing/host-context pieces.
- The canvas stylesheet (which `@imports` @xyflow/react base styles) is intentionally NOT imported by the registration shim — the schema generator runs under tsx/node and cannot load `.css`; the side-effect import lives in the bundle ENTRY instead.
- At render time `zod` is aliased to a no-op stub, so the canvas props schema adds zero runtime weight; the real zod schema only matters to the agent-facing catalog at generation time. The config TS types are derived from the schema's input shape (so `.default()` fields stay optional in authored config).
- The per-node and fullscreen widgets render under the canvas runtime's per-node bridge, so a node's params flow only along its allowed sources — the on-canvas realization of the edge-gated routing rule.
