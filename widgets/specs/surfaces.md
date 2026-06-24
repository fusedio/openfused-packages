# `@fusedio/widgets` — exposed surfaces

What the package gives its consumers (`widget-host/`, `static-ui/`, and external consumers such
as the Flow control-plane app `fusedio/flow`) and the Python server. The package is
**consumed as source**: it is private, ESM-only, and its export map opens every module by
subpath, so a consumer imports by package name + subpath (e.g. `@fusedio/widgets/render`).
The export map publishes three things: a convenience barrel at the package root, every
internal module by its subpath, and the base stylesheet at `@fusedio/widgets/widget.css`.

---

## 1. The barrel (`@fusedio/widgets`)

The default entrypoint re-exports the most common surface:

| Export | Kind | Role |
|---|---|---|
| `componentDefs` | `ComponentDefMap` | type-string → `ComponentDef` (props zod schema + metadata). The catalog the generator walks. |
| `registry` | `ComponentRegistry` | type-string → renderer, **derived** from `componentDefs`. What the tree walk resolves a node's `type` against. |
| `RenderTree` | component | renders a whole config tree under a `FusedWidgetBridge`. |
| `RenderNode` | component | renders a single node (defensive; unknown → placeholder). |
| `UINode` | type | the `{ type, props?, children? }` node shape. |
| `ComponentDef`, `ComponentDefMap`, `ComponentRegistry`, `ComponentRenderer` | types | the render/registry contract. |

## 2. The render surface (`@fusedio/widgets/render`)

The recursive renderer for the `{element}`-contract tree.

- `RenderTree` — wraps the tree in the widget bridge context and renders the config.
  Optional page-level siblings render under the same bridge (e.g. the comments layer).
- `RenderNode` — renders one node: resolves the node's `type` against the registry, passes
  the node as the single `element` prop (never spread), threads `_queryId` down through the
  binding context, and emits the `[data-ofw-node]` comment-anchor marker. Unknown/malformed
  nodes render a visible placeholder.
- `UINode` — the `{ type, props?, children? }` node shape.

## 3. The component catalog (`@fusedio/widgets/widgets`)

The single module the renderer and generator import:

- `componentDefs: ComponentDefMap` — the catalog, collected from the per-component modules.
- `registry: ComponentRegistry` — the type-string → renderer map, derived from `componentDefs`.
- Types: `ComponentRenderer`, `ComponentRegistry`, `ComponentDef`, `ComponentDefMap`.

Each component module default-exports its `ComponentDef`; the per-component prop schema is
also a named export used by the generator and tests. The universal-prop module exports
`UNIVERSAL_PROPS` / `UniversalProps`.

## 4. The reactive host machinery

For a consumer that hosts the renderer (a native React host — the `widget-host/` viewer/parley
or an external control-plane app like Flow — or the standalone bundle):

**`@fusedio/widgets/static-bridge`**
- `createStaticBridge` → `FusedWidgetBridge` — the mostly read-only bridge: SQL queries read
  through the data store, UDF queries no-op, and `$param`/template substitution happens
  locally.
- `createParamsStore` → `ParamsStore` — the in-memory reactive params store (the bridge's
  `params` surface plus snapshot/subscribe-all).
- Types: `WidgetData`, `WidgetErrors`, `ParamsStore`, `StaticBridgeOptions`.

**`@fusedio/widgets/data-store`**
- `WidgetDataStore` — holds resolver rows keyed by `_queryId` and coalesces single-flight
  re-resolve POSTs when a stale read is detected.
- `harvestInitialParams` — pre-order harvest of input `param`/`defaultValue` defaults (and
  the `__comments` seed) to align first paint with the server resolve.
- `mergeLiveComments` — merge-forward of the parley comment plane so a human comment isn't
  clobbered on agent push.
- Types: `DepMap`, `WidgetDataStoreOptions`.

**`@fusedio/widgets/action-sink`**
- `ActionSinkContext` — context for an optional host press handler.
- `type ActionSink = (action, terminal) => boolean | Promise<boolean>`.

## 5. The canvas (`@fusedio/widgets/canvas`)

The free-form layout layer (ReactFlow):

- `CanvasRenderer` — renders a canvas (nodes = widgets, edges = param dataflow).
- `CanvasHostContext`, `useCanvasHost`, `type CanvasHostValue` — the host integration point.

The `canvas` json-ui **widget** wraps this for in-tree use; the canvas
config/routing/param-store internals are subpath-importable but are implementation detail
(see `spec/json-ui-canvas.md`).

## 6. The map renderers (`@fusedio/widgets/maps/*`)

The heavy MapLibre + deck.gl renderers behind `map` / `map-bounds` / `fused-map`. Importable
by subpath, but the **widget** modules are the public entry; these load `maplibre-gl` /
`deck.gl` dynamically and are aliased to a no-op placeholder in the deployed bundle.
Native-app render only.

## 7. Styles

- `@fusedio/widgets/widget.css` — the base widget stylesheet.
- `@fusedio/widgets/canvas/canvas.css` — canvas styling (imported by the canvas layer).

## 8. The generated artifact (build-time output, not an import)

The generator (run via `pnpm --filter @fusedio/widgets generate`) walks `componentDefs`
and writes **`components.json`** into the Python package by default (`OPENFUSED_WIDGETS_OUT`
overrides the output path):

```jsonc
{
  "version": 1,
  "components": [ { "type": "...", "hasChildren": false, "isInput": false }, ... ],
  "generatedFrom": "packages/widgets/src/widgets"
}
```

This is the **hard type gate**: the Python side reads it via `importlib.resources` for
`SUPPORTED_COMPONENTS` / `INPUT_COMPONENTS`. It is the package's only build-time-emitted
contract and the only thing the runtime consumes from this package without JS.

## 9. What it deliberately does **not** expose

- **No MCP tools or resources.** Agents author widget *files*; humans *view* them. The MCP
  server reads `components.json` only.
- **No render-time schema validation.** Prop zod schemas are build-time only; the sole
  runtime gate is the `components.json` type membership check.
- **No `visible`/conditional-render or tab primitive** (would break app paste-compatibility).

---

## 10. The `udfs` bridge — the write seam (proposed; `task-board`)

> This section specifies the render-surface contract for the SDK's `udfs` bridge
> namespace, whose live `execute(udfName, overrides)` method is the `task-board`'s **write**
> channel (the generic event-triggered executor seam, shared with a `button`'s `executor`
> prop). `execute` is real wherever the host wires `createStaticBridge`'s `execUrl` (the
> **`widget-host/` parley surface** and external control-plane consumers such as Flow,
> `fusedio/flow`) and degrades to a structured "unavailable" error elsewhere — it is a
> **resolve-daemon-host-only** capability. The physical-architecture consequences (which
> package gains `@dnd-kit`, the per-surface real/stub table) are in
> [`spec/ui/ui-architecture.md`](../../../spec/ui/ui-architecture.md) §13; the data/write
> grammar, the reserved refs, and the security boundary are in `spec/json-ui-data.md`; the
> resolve-daemon executor and the global resolve context are the consuming host's concern
> (the external Flow app, `fusedio/flow`).

### 10.1 The namespace shape (external, pinned — we wrap, we do not extend)

`udfs` is a namespace of `FusedWidgetBridge` from `@fusedio/widget-sdk@0.3.1`. It is
**external and pinned** — the render surface cannot add task semantics to the SDK; it
**implements around** the existing shape:

```ts
interface UdfBridge {
  // ── the LIVE method (the write seam) ──────────────────────────────────────
  // Synchronous one-shot request/response. `overrides` is a flat {kwarg: value}
  // map of ALREADY-RESOLVED values (the SDK substitutes any $param client-side
  // first). Resolves to the host's {data, error} envelope.
  execute(
    udfName: string,
    overrides: Record<string, string>,
    opts?: { format?: string; signal?: AbortSignal },
  ): Promise<{ data: unknown; error: string | null }>; // UdfExecuteResult

  // ── DORMANT no-op stubs (still in the SDK shape; UNUSED by the task-board) ──
  subscribeOutput(udfName: string, cb: () => void): () => void;
  getOutputSnapshot(udfName: string): UdfOutputSnapshot | undefined;
  requestReexecute(udfName: string): void;
}
interface UdfOutputSnapshot {
  data: unknown;
  isExecutionInProgress: boolean;
  error?: string;
  vfsFilename?: string;
}
```

`execute(udfName, overrides)` is the live method and the `task-board`'s entire write
seam. It carries its mutation arguments **directly** in `overrides` — there is no
"`requestReexecute` takes no args" constraint to work around. The three older methods
(`subscribeOutput` / `getOutputSnapshot` / `requestReexecute`) remain on the namespace as
**dormant no-op stubs** (`static-bridge.ts`: `requestReexecute: () => {}`,
`getOutputSnapshot: () => undefined`, `subscribeOutput: () => unsubscribe`); the
`task-board` does not use them. So:

### 10.2 The execute-carries-args pattern (seam ③)

A `task-board` mutation (drag-to-move, cancel, create) is a **single** `execute` call —
no `params.set` dance, no async snapshot read-back:

1. **Fire `execute(<udf>, overrides)`.** The widget calls the appropriate `_core` UDF
   directly per op (typed kwargs, ADR 0009):
   - move/cancel: `bridge.udfs.execute("_core.task-management.update_status", { id, status })`
     (cancel maps to `status: "cancelled"`),
   - create: `bridge.udfs.execute("_core.task-management.create", { project, title, description })`
     (then `assign` if an assignee was picked),
   - assign: `bridge.udfs.execute("_core.task-management.assign", { id, agent_id })`.
   The SDK has already substituted any `$param` in those values client-side, so the host
   receives already-resolved literals. The host inlines each override as a ref kwarg and
   resolves the `_core` UDF through the ordinary cross-project ref path.
2. **The result returns synchronously** as the `{ data, error }` envelope of the awaited
   call — never via a snapshot. The `_core` UDF writes `~/.openfused/app/state.json`
   directly via stdlib and returns the ack. A non-`null` `error` leaves the prior state
   (the moved card snaps back) and surfaces the error.
3. **Then mutate-then-refetch via a refresh param.** On a clean fire the widget bumps the
   `ofTasksRev` refresh param (`bridge.params.set("ofTasksRev", …)`); the read query
   depends on `$ofTasksRev` (`{{_core.task-management.read?rev=$ofTasksRev}}`), so the bump
   re-resolves it. No optimism for v1 (ADR 0002) — a card reflects a move only once the
   refetch lands.

**Reads stay on `sql.query`/`{{ref}}`; only writes use `udfs` (decided).** The
`task-board` reads its rows through the ordinary `useDuckDbSqlQuery` → `bridge.sql.query`
shortcut over the **read-only** `_core.task-management.read` ref
(`{{_core.task-management.read?rev=$ofTasksRev}}`), exactly like any other data-bound widget.
The `udfs` namespace is **write-only** for the `task-board`; the read channel performs no
writes. The read/write asymmetry is intentional — it keeps the existing resolve plane
untouched for reads and confines the write exception to one namespace.

### 10.3 The host injects the executor via `createStaticBridge`'s `execUrl`

The real `execute` is wired through a **`createStaticBridge` option** — `execUrl`
(`StaticBridgeOptions.execUrl`, `static-bridge.ts`). The host passes the URL of its
udf-exec endpoint, and `createStaticBridge` builds an `execute` that POSTs `{ udf,
overrides }` (plus an optional `format`) to that URL and passes the host's `{ data, error }`
JSON envelope straight through (a transport or non-JSON failure becomes a structured
error). There is **no wrapping bridge** and **no per-name snapshot/listener store** — the
seam is request/response, not subscribe-and-snapshot. The transport lives inside
`createStaticBridge` (not in a consumer-side component) for symmetry with the data store's
resolve fetch, so a consuming host's UI layer stays fetch-free (its import-boundary gate).

**With no `execUrl`, `execute` degrades to a structured "unavailable" error.** Every
surface that does not pass one — the deployed-serve bundle, the MCP-Apps sandbox, any
future host — gets an `execute` that returns `{ data: null, error: "UDF execution is
unavailable on this surface." }`, the same graceful posture as a null `ActionSink`. A
`task-board` rendered there cannot mutate (the press is a visible no-op error, not a crash).
This preserves the package's "mostly read-only bridge" invariant
([`internal-requirements.md`](./internal-requirements.md) §9) for all surfaces without an
`execUrl`: the read channel still works (it rides the resolve plane), only the write seam is
inert. The dormant `requestReexecute` / `getOutputSnapshot` / `subscribeOutput` stubs stay
no-ops on every surface, opt-in or not.

**The real executor is the host's, not the package's.** `createStaticBridge` owns the
transport, but the **host that runs the UDF** is whatever the `execUrl` points at — for an
external control-plane consumer (Flow, `fusedio/flow`), its `/api/projects/:name/udf-exec`
proxy (token added server-side) → the resolve daemon's `POST /api/udf-exec`. That executor is
a **general per-name** runner:
it is **not** restricted to the reserved mutate ref — it runs whatever UDF name `execute`
names, with **full UDF-execution privileges** against the **local** task store (the
in-sandbox `openfused` accessor), **not** the hardened read sandbox alone. It is
**consuming-host-owned and local-only**, and runs on a local compute backend regardless of the
project's configured env (see §10.4 + `spec/ui/ui-architecture.md` §13.3). The host
resolution detail (the one-query plan, the accessor, cache-off) is the consuming host's
concern (the external Flow app, `fusedio/flow`).

### 10.4 What the executor must provide (the host contract this section consumes)

The `execute` seam is a **general per-name UDF executor** — its contract is keyed on an
arbitrary `udfName`, not on the reserved mutate ref:

- **`execute(udfName, overrides) -> Promise<{ data, error }>`** — POST the already-resolved
  `overrides` to the host, which **invokes the named UDF directly** — it locates the source
  via the same `build_sources` path a widget-data resolve uses, then calls the UDF function
  with the overrides as **typed kwargs** (the SDK already resolved `$param`) and returns the
  UDF's **raw return value** as `data` (ADR 0009). It does NOT synthesize
  `SELECT * FROM {{ref}}` and never touches DuckDB. **Caching is pinned off**
  (`cache_max_age="0s"`): a side-effecting executor must never serve a stored hit. `data` is
  the UDF's actual value (for the `task-board`'s reserved mutate name, the ack dict
  `{ ok, op, id }` verbatim — not a one-row list) or `null` alongside a non-`null` `error`.
  The render surface awaits it directly; there is no subscriber to fire and no snapshot to
  read.

The render surface treats this as opaque: it fires `execute`, reads the returned envelope,
and on success bumps a refresh param to re-resolve the read query (mutate-then-refetch). It
makes **no** assumptions about how the executor reaches the task store.

**"Unavailable" detection is capability presence, not a backend check (decided).** Because
the `_core.task-management` UDFs are local-only (the `_core` project is a local project),
the requesting project's compute backend is **irrelevant** to whether the `task-board` works.
The component decides between rendering and the "unavailable" card purely by **whether the
host wired an `execUrl`** — an `execUrl` → a real `execute` → render; no `execUrl` → `execute`
returns the structured "unavailable" error → the inert card. This makes it available on a
**control-plane consumer host** (`execUrl` passed; e.g. the external Flow app, `fusedio/flow`)
and unavailable on the **deployed-serve bundle** (no `execUrl`, no `_core` project in scope).
The exact probe (a capability flag the host sets vs. the component inferring from the
structured "unavailable" error) is a component + consuming-host build detail, not a
package-export concern — but it keys off `execUrl` presence, never the env.

---

## 11. Host-capability context — non-SDK host capabilities (proposed; `task-board`)

> **Status: AS-BUILT** (branch `feat/task-board-widget`). This section specifies the
> render-surface contract for **host-provided capabilities that have no SDK bridge
> namespace** — the general extension point the `task-board` uses for `navigate(path)`
> (click-through to a task's detail / its widget board). Shipped as
> `openfused-host-context.ts` (`OpenfusedHostContext` + `useOpenfusedHost()`), provided by the
> consuming host's `OpenfusedHostProvider`. The physical/per-surface table is in
> [`spec/ui/ui-architecture.md`](../../../spec/ui/ui-architecture.md) §13.3; the
> `navigate` implementation (browser route push) is consuming-host-owned (the external Flow
> control-plane app, `fusedio/flow`).

### 11.1 Why a separate context, not the bridge

The SDK `FusedWidgetBridge` is external and pinned, so it can carry only the capabilities
its namespaces already define. A capability that **maps onto** an existing namespace rides
the bridge via a `createStaticBridge` option (§10.3 — the `udfs.execute` write seam, wired
by `execUrl`). `navigate` has **no** SDK namespace and is not data/param/UDF-shaped; routing
it through the bridge would mean overloading an unrelated namespace. So non-SDK host
capabilities are supplied through a **separate render-surface-owned React context**, provided
alongside the bridge by whatever host mounts the renderer.

### 11.2 The contract (AS-BUILT)

- The package exports the **host-capability context** `OpenfusedHostContext`
  (`openfused-host-context.ts`) and a `useOpenfusedHost()` hook (returns `{}` off-host, so
  readers don't null-check the context itself). The context value is a record of **optional**
  host-provided capabilities:

  ```ts
  interface OpenfusedHost {
    /** Navigate the host to an in-host path (e.g. a task detail). Browser route push
     *  on a control-plane host surface; undefined on surfaces with no router. */
    navigate?: (path: string) => void;
    /** Notify the host to RUN an already-created task — the dispatch seam. The
     *  task-board creates the record via the _core CRUD UDFs (CRUD stays decoupled
     *  from the host), then calls this with the new id so the host reacts and spawns
     *  the run (resolve agent + startRun). The host does no CRUD. Undefined on
     *  surfaces with no dispatcher (deploy-serve / parley) → the record persists and
     *  boot-redispatch runs it later. */
    runTask?: (taskId: string) => Promise<{ error?: string }>;
    /** Open the host's New-task composer modal in place, optionally pre-filled
     *  (e.g. agent-detail's "New task" pre-assigns the agent). The composer is the
     *  host's own create path (it creates + runs); undefined on surfaces with no
     *  modal → caller falls back to a navigate route. */
    openNewTask?: (defaults?: {
      agentId?: string;
      title?: string;
      description?: string;
    }) => void;
  }
  ```

  > **Why `runTask` is a notify seam, not a create seam.** The board's writes (create /
  > move / cancel / assign) are all pure data ops the `_core.task-management` CRUD UDFs
  > satisfy — **CRUD stays decoupled from the host.** But one thing the UDFs *cannot* do is
  > spawn a run: run-spawning (`startRun` → the §13.4 assignment wakeup) lives only in the
  > consuming host's dispatcher (e.g. the external Flow app's Express dispatcher), with no UDF
  > bridge. So the board **creates the record via `_core`**, then calls `runTask(id)` to have
  > the host *react* and start the run — the host creates nothing, it only dispatches an
  > already-created task. Hosts with no dispatcher leave `runTask` undefined; the record
  > persists (created by `_core` all the same) and boot-redispatch runs it on the host's next
  > start. This keeps the create/CRUD circuit in one place (the UDFs) and makes the dispatcher
  > a pure reactor.

- **The host provides it; the package only declares it.** The consuming host supplies
  `{ navigate }` when it mounts the renderer (`RenderTree` already wraps the tree in the bridge
  context; the host provides this context as a sibling provider). The render surface imports
  **nothing** from any consuming host — the same one-way-layering guarantee as the bridge.
- **Every capability is optional and degrades gracefully.** A host that does not provide
  `navigate` (the deployed bundle — no router) leaves it `undefined`; a component reading
  it renders the inert variant (a row/card that does not link), **never a crash** — the
  same defensive posture as an unknown component type or a no-op `udfs`.
- **This is the general extension point.** Any future non-SDK host capability (e.g. a host
  toast, a host "open file") is added as another optional field on the same context rather
  than a new bespoke seam. Capabilities that *do* map onto an SDK namespace still ride a
  `createStaticBridge` option (§10.3 — `execUrl` wires `udfs.execute`) — the two forms are
  complementary, governed by one rule: the host injects, the package declares.

### 11.3 Relationship to the existing `ActionSinkContext`

The package already has one host-injected port — `ActionSinkContext` (§4, the optional
`button`-press handler). The host-capability context is the **same idea generalized**: an
optional, host-provided context the render surface declares and a component reads
defensively. They stay **separate** contexts (the action sink is a single press handler
with accept/reject semantics; the host context is a capability record), but a future
consolidation into one "host services" context is a reasonable follow-up — flagged, not
decided here.
