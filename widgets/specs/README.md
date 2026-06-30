# `@fusedio/widgets` — specs

The design specification for the **JSON-UI render surface** — the package that turns a JSON
tree of `{type, props, children}` nodes into a live, data-bound React UI. These specs
describe intent and contracts; the package source implements them.

> Scope note: this folder is the **package-local** spec. The repo-level JSON-UI specs own
> the *authoring grammar*, the SQL/data contract, and the viewing surfaces:
> `spec/ui/json-ui.md`, `spec/ui/ui-architecture.md`, `spec/ui/data/data.md`,
> `spec/feedback/local.md`, `spec/ui/data/canvas.md`. (The consuming control-plane app's
> own native render/resolve daemon now lives in fusedio/flow.)

## Module specs

| Spec | Question it answers |
|---|---|
| [`overview.md`](./overview.md) | **What is this module for?** Its role, the author→render model, the 35-component catalog at a glance, where it sits in the system. |
| [`authoring.md`](./authoring.md) | **How do you author a config?** The `{type, props, children}` document grammar, the universal `style` prop, style-driven layout (no `visible`/tabs), the data-binding authoring view, and the `button`/selection/`video-review`/`form` feedback semantics. |
| [`catalog.md`](./catalog.md) | **What components exist and how are they kept in sync?** The grouped 35-type catalog table, the single-source-of-truth contract (`defineComponent` → registry + generator), and the `components.json` generation/freshness pipeline. |
| [`rendering.md`](./rendering.md) | **How does a config become React?** The `{element}` render-time contract, the `RenderTree`/`RenderNode` walk, the `_queryId` binding, the static bridge / reactive data+param store, and zod-inert-at-render. |
| [`canvas.md`](./canvas.md) | **How does the free-form canvas render?** The config contract, edge-gated routing (client semantics), auto-layout/folder bands, full-bleed, and the `CanvasHostContext` seam. |
| [`comments.md`](./comments.md) | **How is the comment overlay drawn?** The two overlays over one `__comments` param, the anchor model (`data-ofw-node`), placement rules, the seed prop, and enablement. |
| [`internal-requirements.md`](./internal-requirements.md) | **What internal invariants must it uphold?** Single source of truth, the SDK `{element}` contract, app parity, the `writesParam` lint, the zod-stub build trick, the build-time/runtime split, the reactive data/param model. |
| [`surfaces.md`](./surfaces.md) | **What does it expose?** The barrel + subpath exports, the render surface, the catalog, the reactive host machinery, the canvas/maps, styles, and the generated `components.json`. |

## Per-widget specs ([`widgets/`](./widgets/))

One spec per component type — **why** it exists, the behavioural **expectation**, and the
**exposed params**. Type names match the generated `components.json` type set.

**Display / media**
- [`text`](./widgets/text.md) · [`metric`](./widgets/metric.md) · [`image`](./widgets/image.md) · [`video`](./widgets/video.md) · [`html`](./widgets/html.md) · [`iframe`](./widgets/iframe.md) · [`sql-table`](./widgets/sql-table.md)

**Charts**
- [`bar-chart`](./widgets/bar-chart.md) · [`line-chart`](./widgets/line-chart.md) · [`stacked-area-chart`](./widgets/stacked-area-chart.md) · [`donut-chart`](./widgets/donut-chart.md) · [`stacked-bar-chart`](./widgets/stacked-bar-chart.md) · [`scatter-chart`](./widgets/scatter-chart.md) · [`heatmap-chart`](./widgets/heatmap-chart.md)

**Inputs (write a param)**
- [`dropdown`](./widgets/dropdown.md) · [`slider`](./widgets/slider.md) · [`text-input`](./widgets/text-input.md) · [`text-area`](./widgets/text-area.md) · [`number-input`](./widgets/number-input.md) · [`datetime-input`](./widgets/datetime-input.md) · [`color-input`](./widgets/color-input.md) · [`camera-input`](./widgets/camera-input.md) · [`file-upload`](./widgets/file-upload.md) · [`gallery-input`](./widgets/gallery-input.md)

**Containers**
- [`div`](./widgets/div.md) · [`form`](./widgets/form.md) · [`canvas`](./widgets/canvas.md)

**Maps** (native-app render only; deployed bundle shows a placeholder)
- [`map`](./widgets/map.md) · [`map-bounds`](./widgets/map-bounds.md) · [`fused-map`](./widgets/fused-map.md)

**Source**
- [`sql-runner`](./widgets/sql-runner.md)

**Feedback primitives** (Fused-owned; not app parity)
- [`button`](./widgets/button.md) · [`video-review`](./widgets/video-review.md)
