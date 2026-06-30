# `@fusedio/widgets` — module overview

`@fusedio/widgets` is Fused's **JSON-UI render surface**: the one package that
turns a JSON tree of `{type, props, children}` nodes into a live, data-bound React UI.
It owns the component catalog, the registry/renderer that walks a config tree, the
free-form canvas, the map renderers, the reactive client-side data/param machinery, and
the build-time generator that emits the catalog manifest the Python server reads.

It is one of the TypeScript packages in the pnpm workspace
(`spec/ui/ui-architecture.md` is the canonical owner of that physical layout):

```
widget-host/ → @fusedio/widgets → @fusedio/ui-kit
static-ui/   → @fusedio/widgets
```

`@fusedio/widgets` composes `ui-kit` (dumb shared primitives) and is consumed **as
source** (no npm publish — `package.json` is `private`, `exports` point at `./src/*`) by:

- **`widget-host/`** — the `fused widget open`/parley viewer, which renders configs
  **natively** (no iframe, no bundle). It is also consumed externally — by the standalone
  Flow control-plane app (`fusedio/flow`), which renders its dashboard natively the same way.
- **`static-ui/`** — the standalone bundle host that esbuild-bundles the renderer into
  `widget.html` for the deployed serve plane.

---

## What this module is for

**Author → render, with the host doing all the data work.** The design rests on a hard
split (`spec/ui/json-ui.md`):

1. **One source per component.** A component is defined exactly once with
   `defineComponent({ component, props, description, hasChildren })` (from
   `@fusedio/widget-sdk`) plus an Fused-local `writesParam` flag. From that one source
   the package derives *both* the render registry *and* the generated `components.json`
   manifest — they cannot drift.

2. **The host resolves; the renderer only paints.** Components never run SQL and never
   reach a database. Data-bound nodes carry a DuckDB `sql` string; the host runs it
   server-side (in the same hardened compute sandbox that backs `execute_code`) and hands
   the renderer pre-resolved rows keyed by a stamped `_queryId`. The renderer maps rows to
   nodes and paints.

3. **Inputs make it reactive without a model turn.** Input components broadcast values to
   an in-memory param store; a changed param re-resolves *only* the dependent queries
   server-side via the widget-data endpoint and swaps rows in place.

The result is a **paste-compatible subset of the Fused application's json-ui components**
(same type/prop names + semantics, fewer props, never extra), plus four Fused-owned
primitives — `button`, `video-review`, `canvas`, and `checkbox-group` (the array-writing
multi-select input) — that are not governed by app parity.

## The catalog at a glance

The catalog ships **35 component types** (one canonical map from `type` string to
component). By role:

- **Display / media:** `text`, `metric`, `image`, `video`, `html`, `iframe`, `sql-table`.
- **Charts:** `bar-chart`, `line-chart`, `stacked-area-chart`, `donut-chart`,
  `stacked-bar-chart`, `scatter-chart`, `heatmap-chart`.
- **Inputs (write a param):** `dropdown`, `checkbox-group`, `slider`, `text-input`,
  `text-area`, `number-input`, `datetime-input`, `color-input`, `camera-input`,
  `file-upload`, `gallery-input`.
- **Containers:** `div`, `form`, `canvas`.
- **Maps (native-app only; deployed bundle shows a placeholder):** `map`, `map-bounds`,
  `fused-map`.
- **Source:** `sql-runner` (a named-query container; resolves once, feeds `{{name}}`).
- **Feedback primitives (Fused-owned):** `button`, `video-review`.
- **Task surface (Fused-owned; control-plane consumer surfaces only):** `task-board` (list +
  kanban of tasks, all controls inside, drag-to-change-status + create + cancel via the `udfs`
  write path). The control-plane consumer that renders it is external (Flow, `fusedio/flow`).

Per-component contracts live one file each under [`widgets/`](./widgets/) — *why* the
component exists, the behavioural *expectation*, and the *exposed params*.

## Where it sits in the system

- It is the **render** half of JSON-UI. The **authoring grammar**, the SQL/data contract,
  and the viewing surfaces are specified at the repo level: `spec/ui/json-ui.md` (config
  document + catalog + single source of truth), `spec/ui/data/data.md` (the `{{ref}}` /
  `$param` grammar + the hardened-DuckDB resolver), `spec/feedback/local.md` (the
  `widget-host/` viewer + the parley). The Fused-owned render surfaces are the
  `widget-host/` viewer/parley (native React render) and the deployed serve plane (the
  frozen `widget.html` bundle); external consumers (the Flow control-plane app, `fusedio/flow`)
  render the same configs natively through the same package.
- It exposes **no MCP tools or resources** — agents author widget *files*; humans *view*
  them. The MCP server only reads the generated `components.json`.

## Spec index

| Spec | Covers |
|---|---|
| [`overview.md`](./overview.md) | this file — what the module is and the catalog at a glance |
| [`authoring.md`](./authoring.md) | the authoring contract — the config-document grammar, the universal `style` prop, layout, the data-binding authoring view, and actions & selection |
| [`catalog.md`](./catalog.md) | the component catalog (grouped 35-type table), single source of truth, and `components.json` generation |
| [`rendering.md`](./rendering.md) | the render-time `{element}` contract, the `RenderTree`/`RenderNode` walk, `_queryId` binding, the host bridge, and zod-inert-at-render |
| [`canvas.md`](./canvas.md) | the canvas rendering surface — config contract, edge-gated routing (client), auto-layout, full-bleed, the host seam |
| [`comments.md`](./comments.md) | the comment-overlay rendering surface — the two overlays, the `data-ofw-node` anchor model, placement, enablement |
| [`internal-requirements.md`](./internal-requirements.md) | the invariants the package must uphold (single source of truth, the SDK `{element}` contract, the zod-stub build trick, the reactive data/param model, the build-time/runtime split) |
| [`surfaces.md`](./surfaces.md) | everything the package exports and the artifact it generates |
| [`widgets/`](./widgets/) | one spec per component type (why / expectation / exposed params) |
