# `@fusedio/widgets` — internal requirements

The invariants this package must uphold for the JSON-UI render surface to be correct,
generatable, and bundleable. These are normative: a change that breaks one of them breaks
either the generator, the deployed bundle, or app-parity.

---

## 1. Single source of truth: the component catalog

Every renderable component is defined **once** and only once.

- A component module per `type` default-exports
  `{ ...defineComponent({ component, props, description, hasChildren }), writesParam }`
  — the SDK's `CatalogComponentDefinition` plus the Fused-local `writesParam` flag
  (the package's `ComponentDef` shape).
- The **catalog map** (`componentDefs`) is the type-string → `ComponentDef` record. Adding a
  component is a one-line edit there plus the new per-`type` component module.
  **The map key MUST equal the component's json-ui `type` string** (it names the generated
  schema entry and the spec file).
- The barrel re-exports `componentDefs` and **derives** the render `registry` from it (each
  def's `.component`). The registry is never hand-authored. **Consequence:** every renderable
  type has a catalog entry and vice-versa — they cannot drift.

This one source feeds **two** consumers that must never disagree:

1. **The renderer** — looks each node's `type` up in `registry`.
2. **The generator** — walks `componentDefs` to emit `components.json` (the Python-side hard
   type gate).

## 2. The SDK `{element}` render contract

Components are authored against `@fusedio/widget-sdk` alone, never a bespoke prop spread.

- A renderer is `ComponentType<ComponentRenderProps>` — it receives a **single `element`
  prop** (`{ type, props, children }`) and reads `element.props`. The renderer invokes
  `<Component element={…} />` and **NEVER spreads `element`**.
- Components reach host state **only** through SDK hooks backed by a `FusedWidgetBridge`
  from `FusedWidgetBridgeContext`: `useFusedParam`/`useFusedParamWithForm` for inputs,
  `useDuckDbSqlQuery` for data, and the SDK's style-parsing / param-substitution / `template`
  helpers for text. No component touches the network, a DB, or a global store directly.
- A data-bound node's `props._queryId` (resolver-stamped) is threaded into the SDK data
  hook via `JsonUiBindingContext`; the renderer wraps such nodes so the query id is in scope.
- An unknown `type` degrades to a visible placeholder — **never a crash**.
- Each rendered node is wrapped in a layout-neutral marker (no layout box generated) carrying
  a stable path on a `data-ofw-node` anchor for the page-level comment overlay.

## 3. The universal prop

There is exactly **one** universal prop: `style` (an optional inline-CSS declaration
string), declared once as `UNIVERSAL_PROPS` and folded into every component via
`.extend(UNIVERSAL_PROPS.shape)`. It is parsed to a style object and merged **over** the
component's defaults.

- There is intentionally **no universal `visible` prop** and no conditional-render / tab
  primitive — the Fused app has neither and lints props with `.strict()`, so a `visible`
  key would break paste-compatibility. Fused's component set is a strict **subset** of
  the app's.

## 4. App parity (paste-compatibility)

Each component (except the three Fused-owned primitives) must be a strict,
paste-compatible **subset** of the matching Fused application component: identical type +
prop names + semantics, **fewer** props, **never** extra. Deliberate *behavioural* subsets
(e.g. `text` renders a literal `value` as-authored rather than substituting inline
`$param`/`{{udf}}`; map `param` emits a `"w,s,e,n"` string instead of the app's array) are
allowed and are documented in the component's source header and per-widget spec.

The three primitives **not** governed by app parity, owned by Fused spec:

- `button` and `video-review` — the human's feedback/reply channel (`spec/ui/json-ui.md`
  § Actions & selection).
- `canvas` — the free-form layout surface (`spec/json-ui-canvas.md`).

## 5. The `writesParam` flag (input contract)

`writesParam: true` marks an **input** — a component that broadcasts a value to the param
store. It is a required, **linted** flag:

- The generator surfaces it as each component's `isInput` flag in `components.json`
  (seeds first-paint param defaults server-side).
- **LINT (generation throws):** any component whose generated props schema exposes **both**
  `param` and `defaultValue` but is **not** marked `writesParam: true` fails generation —
  an undeclared input would silently break first-paint seeding.
- Inputs that broadcast **non-scalar** values (arrays/objects — e.g. `video-review`,
  table selection arrays) must never have those params referenced in SQL: `$param` is text
  substitution, so only scalars are SQL-safe.

## 6. Generatability under Node (no real render at generate time)

The generator runs the catalog under Node, reads only schema **metadata**, and never invokes
a renderer. Two requirements make this safe:

- **Real zod at generate time.** The generator imports the REAL `zod`, converts each def's
  props schema to JSON Schema and sanitizes it for the lint check, then emits
  `components.json` (`{ version, components: [{type, hasChildren, isInput}], generatedFrom }`,
  sorted). The output directory is overridable via `OPENFUSED_WIDGETS_OUT` (default: the
  committed Python-package widgets directory).
- **Browser-global shims.** Importing the barrel pulls `recharts` (and React-DOM),
  which touch browser globals at module-eval time. The generator installs minimal
  `globalThis` shims (`process`, `window`, `document`, `navigator`,
  `requestAnimationFrame`, `getComputedStyle`) **before** a dynamic import of the barrel.

## 7. The zod stub: keep render bundles schema-free

Every component imports `z` to declare its prop schema at module-load time, but **no render
path ever `.parse()`s** with it. The schemas exist only for the generator.

- A no-op `Proxy` stand-in for `zod` exists. The standalone bundle build aliases the exact
  `zod` specifier to it via an esbuild resolve plugin, so ~300 KB of zod is never inlined into
  `widget.html`.
- The stub must keep the schema-declaration **syntax** valid: every call/property access
  returns a chainable callable proxy. It must be **spread-safe** — `{ ...X.shape }` yields
  an empty object and `for…of X.shape` does not throw — and obey the Proxy `ownKeys`
  invariant (report the function target's non-configurable `prototype`).
- The generator uses the **real** zod; the stub never runs there.

## 8. Build-time vs runtime split

- **Build time only:** the typed prop schemas, the generator, and the renderer bundle. The
  runtime (Python server) reads the committed `components.json` via `importlib.resources` and
  never invokes a JS toolchain.
- **Freshness, not parity:** CI regenerates `components.json` and fails if it drifts from a
  fresh generate; a pre-commit hook regenerates on definition edits. There is no
  hand-maintained parallel list to keep in sync.

## 9. Reactive data + param model (client side)

For the standalone/native render the package owns a small reactive layer so inputs are live
without a model turn:

- **Params store** (`createParamsStore`): a real in-memory reactive `Map` satisfying
  `FusedWidgetBridge["params"]` (`subscribe`/`getSnapshot`/`set`/`clear` + the
  `subscribeMany`/`getSnapshotMany` batch forms), plus two session extras (`snapshotAll`,
  `subscribeAll`) used by the session/parley reporters.
- **Data store** (`WidgetDataStore`): holds the resolver-produced rows by `_queryId`, inverts
  the planner dependency map (`param → [qid]` ⇒ `qid → [params]`), tracks a per-qid param
  snapshot, and on a stale read coalesces a **single-flight** POST to the widget-data
  endpoint (a superseding request aborts the in-flight one; stale responses are discarded by a
  snapshot-identity guard). A per-qid error surfaces in-card and never blanks the widget.
- **Static bridge** (`createStaticBridge`): a mostly read-only `FusedWidgetBridge` — SQL
  queries read through the data store's freshness check; UDF queries are no-ops;
  `template.render` does best-effort local `$param` substitution. The `params` sub-bridge is
  the *one* genuinely reactive piece.
  - **The `udfs` namespace default is and stays a no-op stub** (`requestReexecute: () =>
    {}`, `getOutputSnapshot: () => undefined`, `subscribeOutput: () => unsubscribe`). The
    one component that needs a real `udfs` — `task-board` (its **write** channel) — gets it
    from a **host-injected, general per-name, full-privilege, local executor** (not
    restricted to the reserved mutate ref), never from `createStaticBridge` itself. The
    `task-board` is **enabled wherever a real executor is injected** (a control-plane consumer
    host that wires `execUrl` — now external, Flow, `fusedio/flow`) and degrades to
    **"unavailable" only where the stub stands in** (the deployed-serve bundle) — detection is
    executor presence, not a backend check. The render surface declares the contract and
    consumes whatever `udfs` the bridge in context carries; it introduces **no** import from
    any consuming host. Full contract: [`surfaces.md`](./surfaces.md) §10; physical/per-surface
    table: `spec/ui/ui-architecture.md` §13. (Proposed, branch `feat/task-board-widget`.)
- **Initial-params harvesting** (`harvestInitialParams`) and **comment merge-forward**
  (`mergeLiveComments`) keep the first paint and the parley comment loop consistent with
  what the server resolved.
- **Action sink** (`ActionSink` / `ActionSinkContext`): an optional host-provided
  `(action, terminal) → accepted` handler that, when present, takes precedence over
  session/parley routing for `button` presses (`spec/json-ui-inbox.md` §4).

## 10. Heavy renderers stay node-importable / bundle-aware

- Map renderers import `maplibre-gl` and `deck.gl` **dynamically**, so the widget modules
  stay node-importable by the generator. The deployed bundle aliases `map`, `map-bounds`,
  `fused-map` to a placeholder renderer (external tiles break the self-contained-bundle
  invariant) → these three render in the **native app only**.
- `recharts` is imported normally but is the reason the generator installs browser shims
  (§6).
- The canvas statically imports ReactFlow (`@xyflow/react`); the host bundles as a single
  inlined esbuild bundle (no code-splitting), so lazy-loading is deferred.

## 11. Tests & generation tooling

- Unit/browser tests live beside the code; `vitest` runs the unit suite and a browser mode
  (Playwright-backed) runs the browser suite.
- `pnpm --filter @fusedio/widgets generate` runs the generator; `pnpm … typecheck` /
  `test` / `test:browser` are the other scripts.
