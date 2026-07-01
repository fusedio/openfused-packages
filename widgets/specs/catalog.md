# `@fusedio/widgets` — the component catalog

The catalog ships **40 component types**. This file is the **summary table** of that
catalog, grouped by role, plus the single-source-of-truth + generation contract that makes
the catalog impossible to drift. It is *not* the prop reference: each row links to that
component's spec under [`widgets/`](./widgets/), which is **authoritative for props,
behaviour, and exposed params**. The render-time `{element}` contract and the registry the
renderer resolves a node's `type` against live in [`rendering.md`](./rendering.md); the
config-document grammar, the universal `style` prop, layout, and data-binding are in
[`authoring.md`](./authoring.md).

Most types are a strict, **paste-compatible subset** of the Fused application's json-ui
components (same `type` names, same prop names/semantics — Fused implements *fewer*
props, never extra). Several are Fused-owned primitives **not** governed by app parity:
`button` and `video-review` (feedback primitives, [`authoring.md`](./authoring.md) § Actions
& selection), `canvas` (the free-form layout surface, [`canvas.md`](./canvas.md)),
`checkbox-group` (the array-writing multi-select input, with no app equivalent — it aligns to
Fused's own `dropdown` conventions), `task-board` (the task surface — list + kanban +
all controls; [`widgets/task-board.md`](./widgets/task-board.md)), and the prose/diff pair
`markdown` (GitHub-flavored markdown rendering) and `diff` (a colored before/after or unified
diff — built for markdown spec review). The `markdown` and `diff` renderers are **shared with
a control-plane consumer's task thread** (`MarkdownView`/`DiffView` from `@fusedio/widgets`;
that consumer is now external — Flow, `fusedio/flow`) — one implementation, two surfaces.

---

## The catalog at a glance

The universal `style` prop applies to every type and is omitted from the table. `sql` is the
data-binding prop; **data-bound** marks whether a row reads it. `text` and `dropdown` take an
*optional* `sql` — they are data-bound only when it is set. **Key props** is a summary, never
the contract — see the linked per-widget spec for the full prop schema.

### Display / media

| type | purpose | key props | data-bound |
|---|---|---|:--:|
| [`text`](./widgets/text.md) | static or dynamic text | `value` / `sql`, `variant` | optional (`sql`) |
| [`markdown`](./widgets/markdown.md) | render GitHub-flavored markdown (prose, tables, code) | `value` / `sql` | optional (`sql`) |
| [`diff`](./widgets/diff.md) | colored diff of two texts (markdown spec review) | `before` / `after`, or `diff` | no |
| [`metric`](./widgets/metric.md) | metric card with a formatted single value | `value` / `sql`, `label`, `format`, `prefix`, `suffix`, `decimals` | yes |
| [`image`](./widgets/image.md) | image from a URL / data URL / signable storage path | `src`, `alt`, `objectFit` | no |
| [`video`](./widgets/video.md) | video player from a URL / data URL | `src`, `poster`, `controls`, `autoplay`, `loop`, `muted` | no |
| [`html`](./widgets/html.md) | raw-HTML escape hatch (**scripts execute** in the page DOM) | `value` | no |
| [`iframe`](./widgets/iframe.md) | sandboxed embed of a page or HTML-returning UDF (`src` must be absolute http(s)) | `src`, `title`, `allow` | no |
| [`sql-table`](./widgets/sql-table.md) | table rendered from a query | `sql`, `title`, `sortable`, `filterable`, `maxRows`, `groupBy` (or `idColumn`/`parentColumn` for master-detail) | yes |

### Charts (read **fixed columns** from the query result)

| type | purpose | reads columns | key props | data-bound |
|---|---|---|---|:--:|
| [`bar-chart`](./widgets/bar-chart.md) | bar chart | `label`, `value` | `sql`, `title`, `barColor`, `horizontal`, `showValues` | yes |
| [`line-chart`](./widgets/line-chart.md) | line / area chart | `label`, `value`, opt. `series` | `sql`, `title`, `lineColor`, `curveType`, `showArea` | yes |
| [`stacked-area-chart`](./widgets/stacked-area-chart.md) | stacked area chart | `label`, `value`, opt. `series` | `sql`, `title`, `curveType`, `showLegend`, `showBrush` | yes |
| [`donut-chart`](./widgets/donut-chart.md) | donut chart | name, value | `sql`, `title`, `innerRadius`, `showLabels`, `showCenterTotal` | yes |
| [`stacked-bar-chart`](./widgets/stacked-bar-chart.md) | stacked bar chart | `label`, `value`, opt. `series` | `sql`, `title`, `horizontal`, `showLegend`, `showValues`, `barColor` | yes |
| [`scatter-chart`](./widgets/scatter-chart.md) | scatter chart | `x`, `y`, opt. `series` / `size` / `label` | `sql`, `title`, `pointColor`, `showGrid`, `showLegend`, `xLabel`, `yLabel` | yes |
| [`heatmap-chart`](./widgets/heatmap-chart.md) | matrix heatmap (custom CSS/SVG grid) | `x`, `y`, `value` | `sql`, `title`, `lowColor`, `highColor`, `showValues` | yes |

Charts read fixed result columns, **not** `x`/`y` props — alias your SELECT accordingly
(e.g. `select month as label, sum(revenue) as value …`). `scatter-chart` and `heatmap-chart`
are the only charts keyed on `x`/`y` columns. The exact column contract per chart is in its
linked spec.

**Axis titles.** Cartesian charts (`bar-chart`, `line-chart`, `stacked-bar-chart`,
`stacked-area-chart`) take optional `xAxisLabel` / `yAxisLabel` props that render an axis
*title* (the name of the dimension, e.g. "Species" / "Count") — distinct from the per-tick
labels. `scatter-chart` already names its axes via `xLabel` / `yLabel`. Always set these so a
chart is self-explaining; an unlabeled axis is an incomplete chart. The components reserve
extra margin/height automatically when a title is set, so nothing clips.

### Inputs (write a param)

| type | control | key props |
|---|---|---|
| [`dropdown`](./widgets/dropdown.md) | dropdown (static `options` or `sql`) | `param`, `options` / `sql`, `defaultValue`, `placeholder`, `nullable` |
| [`checkbox-group`](./widgets/checkbox-group.md) | multi-select checkboxes; writes an **ARRAY** param (Fused-owned, no app equivalent) | `param`, `options` / `sql`, `defaultSelected`, `minSelected`, `maxSelected` |
| [`slider`](./widgets/slider.md) | numeric slider | `param`, `min`, `max`, `step`, `defaultValue` |
| [`text-input`](./widgets/text-input.md) | text field | `param`, `placeholder`, `defaultValue`, `debounceMs`, `type` |
| [`text-area`](./widgets/text-area.md) | multi-line text field | `param`, `placeholder`, `defaultValue`, `rows`, `debounceMs` |
| [`number-input`](./widgets/number-input.md) | numeric field | `param`, `min`, `max`, `step`, `defaultValue`, `placeholder` |
| [`datetime-input`](./widgets/datetime-input.md) | date / time / datetime field | `param`, `mode`, `defaultValue`, `min`, `max` |
| [`color-input`](./widgets/color-input.md) | color picker | `param`, `defaultValue`, `showValue` |
| [`camera-input`](./widgets/camera-input.md) | capture a photo (`getUserMedia`) → data-URL param | `param`, `facingMode`, `label` |
| [`file-upload`](./widgets/file-upload.md) | upload file(s) → data-URL param | `param`, `accept`, `multiple`, `maxSizeMb`, `label` |
| [`gallery-input`](./widgets/gallery-input.md) | pick one of N preset images → param | `param`, `options`, `defaultValue` |

`dropdown` and `checkbox-group` are the inputs that are optionally data-bound (`sql` returning
`value` / `label` columns; identical normalization). `checkbox-group` is the one input that
writes a **non-scalar** value — an ARRAY of the ticked option values, like `sql-table`'s
`selectionParam`; that array is feedback for the agent and **must never be referenced in SQL**
([`json-ui-data.md`](../../../spec/ui/data/data.md)). `camera-input` / `file-upload` /
`gallery-input` broadcast a **data URL** (or array) as the param value. Every input declares
`writesParam: true` — see *Single source of truth*.

### Containers

| type | purpose | key props | children |
|---|---|---|:--:|
| [`div`](./widgets/div.md) | container; defaults to a flex column, fully `style`-driven | (`style` only) | yes |
| [`form`](./widgets/form.md) | container; collects descendant inputs and broadcasts **on submit** | `param` (bundle), `style` | yes |
| [`canvas`](./widgets/canvas.md) | free-form layout: nodes are widgets, wired by edges carrying param dataflow (Fused-owned; [`canvas.md`](./canvas.md)) | `nodes` (`[].widget`), `edges` | no |

`form` collects descendant inputs into a field store and broadcasts **on submit** (a
descendant `button`), not while typing — with a top-level `param` it bundles all fields into
one JSON object; without one, each field broadcasts to its own `param`. Unlike the
application, charts/tables inside a form update **on submit**, not live (no client DuckDB) —
see [`widgets/form.md`](./widgets/form.md).

### Maps (render in the **native app only** — the deployed bundle shows a placeholder)

| type | purpose | key props | data-bound |
|---|---|---|:--:|
| [`map`](./widgets/map.md) | one or more layers on a no-token MapLibre basemap (deck.gl `GeoJsonLayer` per layer; static + data-driven `vizConfig`); each layer binds by `udf` (shorthand) or an explicit `sql` (may carry `$param` → param-driven); optionally emits viewport bounds to a param | `layers` (`[{udf \| sql, visible?, vizConfig?}]`), `mapStyle`, `centerLng`, `centerLat`, `zoom`, `param`, `sendParam`, `label` | yes (via `layers[].udf` or `layers[].sql`) |
| [`map-bounds`](./widgets/map-bounds.md) | interactive map that writes its viewport bounds as `"west,south,east,north"` to a param | `param`, `centerLng`, `centerLat`, `zoom`, `mapStyle`, `autoSend`, `buttonLabel` | no |
| [`fused-map`](./widgets/fused-map.md) | rich multi-layer deck.gl map (scatterplot/geojson/h3/heatmap/arc + mvt/raster, data-driven color, tooltips, legend, layer + basemap panels); each layer's `sql` returns its data | `layers` (`[{id, type, sql, latColumn/lngColumn/geometryColumn/h3Column, style, tooltip, legend}]`), `basemap`, `centerLng`, `centerLat`, `zoom`, `param`, `showLegend`, `showLayerPanel`, `showBasemapSwitcher` | yes (via `layers[].sql`) |

The three map widgets need heavy WebGL deps + external tiles the self-contained deployed
bundle does not ship, so the deployed-bundle build aliases the map modules to a placeholder;
they render only in the native app. See [`canvas.md`](./canvas.md) for the
canvas-integration fixes and [`internal-requirements.md`](./internal-requirements.md) for the
dynamic-import / placeholder-alias invariant.

### Source

| type | purpose | key props | data-bound |
|---|---|---|:--:|
| [`sql-runner`](./widgets/sql-runner.md) | container that runs a named query once and exposes the result to descendant queries as `{{name}}`; a server-side source, not a rendered output | `name`, `sql` | source |

`sql-runner` is a named-query **source** tier ahead of the `udfs/` registry: the host runs its
`sql` to a DataFrame and registers it as `{{name}}` for descendants. It renders everywhere (it
ships no heavy deps). The resolver coupling is host-owned — see `spec/ui/data/data.md`.

### Feedback primitives (Fused-owned — not governed by app parity)

| type | purpose | key props | data-bound |
|---|---|---|:--:|
| [`button`](./widgets/button.md) | action button — `executor` runs a UDF on press (`udf?k=$param`); `action` reports a feedback event (`submit: true` settles a feedback session) | `label`, `executor`, `action`, `submit`, `variant` | no |
| [`video-review`](./widgets/video-review.md) | timestamped video feedback for agent-made videos (parley loop); writes open comments to a param, QA verdicts to another | `src`, `param`, `defaultValue`, `rounds`, `qaParam`, `title` | no |

Both carry intent beyond input values and are owned by [`authoring.md`](./authoring.md) §
Actions & selection. `canvas` (in Containers above) is the third Fused-owned primitive, and
`task-board` (below) the fourth.

### Task + agent surfaces (Fused-owned — not governed by app parity)

| type | purpose | key props | data-bound |
|---|---|---|:--:|
| [`task-board`](./widgets/task-board.md) | the paperclip task-view as a widget: list + kanban of a project's (or all) tasks, all controls inside, drag-to-change-status + create + cancel + assign; reads `{{_core.task-management.read}}` SQL, writes by firing the `_core.task-management.update_status` (move/cancel), `create`, and `assign` UDFs through the §11 executor seam (`bridge.udfs.execute`), then bumps a refresh param to refetch. **Control-plane consumer surfaces only** (where `_core.*` refs resolve; the consumer is external — Flow, `fusedio/flow`) — the deployed-serve bundle renders "unavailable" | `project`, `sql`, `defaultView`, `defaultGroupBy`, `taskHref` | yes |
| [`agent-detail`](./widgets/agent-detail.md) | the per-agent interface as a widget: Overview (config edit + stats) / Runs / Instructions; reads the one agent row via `{{_core.agents-management.read?slug=$agentSlug}}` SQL, loads runs lazily via an executor read of `_core.task-management.read`, saves config/prompt via `_core.agents-management.update` then reflects the returned record (no re-resolve). Adapter options are injected at render by the consumer's container. **Control-plane consumer surfaces only** (the consumer is external — Flow, `fusedio/flow`) | `agentSlug`, `sql`, `adapters`, `taskHref`, `newTaskHref` | yes |

`task-board` is the **fourth Fused-owned spec-owned primitive that breaks app parity** (after
`button`, `video-review`, and `canvas`). The Fused application has no task concept, so there is
nothing to be paste-compatible with. It is also the first widget to **write** through the resolve
plane (handoff ADR 0002) and the first to iterate a collection into per-row / per-lane layouts. It
runs on a **control-plane consumer surface** (now external — Flow, `fusedio/flow`) — the
`_core.task-management` UDFs always run on the local consumer's compute host (the `_core` project
is local-only), so it works for AWS-backed projects too; only the deployed-serve bundle (no
`_core` project in scope, no `execUrl`) renders "unavailable." See
[`widgets/task-board.md`](./widgets/task-board.md), `spec/ui/json-ui.md` § Authoring & catalog,
and `spec/ui/data/data.md`.

---

## Single source of truth

Every renderable component is defined **exactly once** — in its own per-type module, which
default-exports a `ComponentDef` built by spreading `defineComponent({ component, props /* zod */, description, hasChildren })`
and appending the local `writesParam` flag.

`defineComponent` (from `@fusedio/widget-sdk`) carries the renderer + the inline **zod** prop
schema + a one-line description + `hasChildren`; the package appends the local `writesParam`
flag (the SDK does not know it). The single universal prop (`style`) is declared once and
composed into every component's schema, never restated per type.

A single map, `componentDefs` (type-string → `ComponentDef`), imports all 34 modules. From
that **one** map, two things are *derived* — they cannot drift:

- **The render registry** — derived by collecting each def's `.component`. The renderer
  resolves a node's `type` against this same map ([`rendering.md`](./rendering.md)).
- **The generated manifest** — the generator walks the *same* `componentDefs`.

There is no parallel Python list and no hand-maintained second catalog; both consumers walk
the one map.

---

## Generation

The generator (run via `pnpm --filter @fusedio/widgets generate`) walks
`componentDefs` and emits **one** artifact — `components.json`:

```jsonc
{
  "version": 1,
  "components": [ { "type": "...", "hasChildren": false, "isInput": false }, … ],
  "generatedFrom": "packages/widgets/src/widgets"
}
```

- The `components` array is sorted by `type` (deterministic, stable, agent-visible). Each
  entry is `{type, hasChildren, isInput, props}`, where `isInput = !!def.writesParam` and
  `props` is the sorted list of **allowed prop names** — the keys of the sanitized Draft-07
  `propsSchema.properties` for that component. `props` lets the Python side surface an
  advisory "ignored prop" signal without a hard render.
- `components.json` is the **hard type gate**: the Python side reads it via
  `importlib.resources` for `SUPPORTED_COMPONENTS` / `INPUT_COMPONENTS` (and now the per-type
  allowed-prop list). It is the package's only build-time-emitted contract and the only thing
  the runtime consumes from this package without JS. See [`surfaces.md`](./surfaces.md) § 8.
- A sibling **browser artifact** `src/widgets/generated/allowed-props.json` is emitted for the
  renderer — a slim, bundle-internal `{ "<type>": ["<prop>", ...], ... }` map (no version
  wrapper). It always lands inside `packages/widgets/src` so the browser esbuild bundles it,
  and is **not** redirected by `OPENFUSED_WIDGETS_OUT` (that override targets only the Python
  `components.json` dir).
- Output dir for `components.json` is the committed Python package by default;
  `OPENFUSED_WIDGETS_OUT` overrides it (the freshness gate points it at a temp dir so the
  committed file is never touched).

**The `writesParam` lint.** While walking, the generator runs the props through zod's
JSON-Schema conversion *only* to lint: a component whose props expose **both** `param` and
`defaultValue` but is **not** marked `writesParam` **throws** — an undeclared input would
silently fail the server-side `isInput` contract (first-paint param seeding would break).
The per-type Draft-07 schemas are no longer emitted as files — they are computed transiently
for this lint and discarded. This lives in the generator.

**Freshness, not parity.** CI regenerates `components.json` into a temp dir and fails if it
differs from the committed file (proving the artifact matches the definitions). This is a
**freshness check** on a single generated artifact, *not* a parity gate between two
hand-maintained lists — drift is impossible by construction. A pre-commit hook regenerates on
edits to the definitions.

> **Gone:** the `schema/` per-type JSON-Schema files and the agent-facing `guide/` generation
> no longer exist. There is **no soft prop validation** at render — the sole runtime gate is
> the `components.json` type-membership check. `internal-requirements.md` is the canonical
> owner of this build-time-only / runtime-reads-nothing invariant.

---

## Adding a widget

Adding a component is a small, fixed set of edits:

1. **Author the per-type module** — default-export `{ ...defineComponent({…}), writesParam }`.
2. **Register it** — add one `"<type>": <import>` entry to the `componentDefs` map (the
   registry derives automatically).
3. **Regenerate** — `pnpm --filter @fusedio/widgets generate` rewrites `components.json`
   (the freshness gate then passes).
4. **Add `packages/widgets/specs/widgets/<type>.md`** — the per-component spec (why /
   expectation / exposed params) and add a row to the table above.

No parallel Python list to sync. An input must set `writesParam: true` (the lint enforces it
when `param` + `defaultValue` are both present).

---

## App parity

Most components are a strict, paste-compatible **subset** of the Fused application's json-ui
components: same `type` names, same prop names/semantics, Fused implements *fewer* props
and never extra. A config authored against these pastes into the application and behaves
identically. Four components are Fused-owned and **not** governed by app parity:

- **`button`** and **`video-review`** — feedback primitives ([`authoring.md`](./authoring.md)
  § Actions & selection).
- **`canvas`** — the free-form layout surface ([`canvas.md`](./canvas.md)).
- **`checkbox-group`** — the array-writing multi-select input. The application's only selection
  input is single-select `dropdown` (its multi-select facet is `sql-table` row-selection), so
  `checkbox-group` aligns its props to Fused's own `dropdown`, not to an app component.

Documented semantic differences inside the parity subset (not bugs): `form` is
submit-to-apply, not live-shadow (no client DuckDB), and the deferred / placeholder map
behaviour above.

---

## Cross-references

- [`authoring.md`](./authoring.md) — the config-document grammar, the universal `style` prop,
  layout, data-binding, and the actions/selection feedback contract for `button` /
  `video-review` / selection params.
- [`rendering.md`](./rendering.md) — the render-time `{element}` contract, the registry,
  `queryId` binding, and the `RenderTree` / `RenderNode` walk that consume this catalog.
- [`surfaces.md`](./surfaces.md) — the package exports (`componentDefs`, `registry`) and the
  generated `components.json` shape.
- [`internal-requirements.md`](./internal-requirements.md) — the single-source-of-truth /
  bundled-zod / build-time-only invariants this catalog rests on.
- [`canvas.md`](./canvas.md), [`comments.md`](./comments.md) — the canvas and comment-overlay
  rendering surfaces.
- [`widgets/`](./widgets/) — one spec per component type (**authoritative for props**).
- `spec/ui/data/data.md` (host) — the `{{ref}}` / `$param` grammar and the hardened-DuckDB
  resolver that resolves data-bound nodes and the `sql-runner` source.
