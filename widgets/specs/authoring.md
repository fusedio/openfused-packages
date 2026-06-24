# `@fusedio/widgets` — the authoring contract

What an **author** writes: the shape of a JSON-UI config document, the one universal
prop, how layout is expressed, what makes a node data-bound, and the action/selection
feedback semantics. This is the package's authoring view — *what you put in the file*.

It is deliberately split from the rest of the package spec set: the **catalog** (the
35-type table, per-component props, single source of truth, generation) is in
[`catalog.md`](./catalog.md) and [`widgets/`](./widgets/); *how* a config is turned into
painted React (the `{element}` contract, the registry, `queryId` binding, the reactive
flow) is in [`rendering.md`](./rendering.md); and the **SQL/data contract** the host
runs (the `{{ref}}` / `$param` grammar, resolution, security) is the host's, in
`spec/json-ui-data.md`. This file cross-links those; it does not restate them.

Source of these claims: `spec/ui/json-ui.md` (the authoring surface), the in-scope
component narrative in `spec/ui/json-ui-widgets-batch1.md`, and the package's renderer,
the universal-prop declaration, and the `div` container component.

---

## The config document

A config is a **single JSON document** — a recursive tree of nodes, each the universal
shape:

```jsonc
{ "type": "<component>", "props": { /* component props */ }, "children": [ /* nodes */ ] }
```

There is **no envelope, no version field, no `$schema`** — the document *is* the root
node. Rules:

- **`type`** — required, a non-empty string, looked up in the component registry
  (`registry[node.type]`, derived from `componentDefs`). A config naming any type outside
  the supported set is rejected with a structured error **before any render** — the single
  hard type gate is `components.json` ([`catalog.md`](./catalog.md)). A type that *reaches*
  the renderer with no registry entry degrades to a visible "unknown component" placeholder,
  never a crash.
- **`props`** — optional object. One prop is **universal**, valid on *every* type, and
  handled by the renderer rather than the component: `style` (an inline-CSS string — see
  below). Every other prop is component-owned ([`widgets/`](./widgets/)).
- **`children`** — optional; an array of nodes, a single node, or `null`. Only container
  types (`div`, `form`, `canvas`, `sql-runner`) render children; data and input components
  ignore them.

**Root convention.** Use a single container as the root (`div` for a dashboard,
`canvas` for a free-form layout). The root's `props.title` / `props.description` render
as the dashboard heading.

### Example

```json
{
  "type": "div",
  "props": { "title": "Sales overview", "style": "gap: 16px; padding: 16px" },
  "children": [
    { "type": "text", "props": { "value": "Revenue across regions", "variant": "h3" } },
    { "type": "div", "props": { "style": "display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px" },
      "children": [
        { "type": "dropdown", "props": { "param": "region", "label": "Region",
            "options": [ { "value": "all", "label": "All" },
                         { "value": "emea", "label": "EMEA" },
                         { "value": "amer", "label": "Americas" } ],
            "defaultValue": "all" } },
        { "type": "slider", "props": { "param": "min_revenue", "label": "Min revenue",
            "min": 0, "max": 500, "defaultValue": 0 } },
        { "type": "metric", "props": { "label": "Total revenue", "format": "currency", "prefix": "$",
            "sql": "select sum(revenue) as value from {{sales?region=$region}}" } }
      ]
    },
    { "type": "sql-table", "props": { "title": "Raw rows",
        "sql": "select month, region, revenue from {{sales?region=$region}} where revenue >= $min_revenue order by month limit 50" } }
  ]
}
```

The `dropdown` and `slider` **write** `$region` / `$min_revenue`; the `metric` and
`sql-table` **read** them and re-resolve live when they change — without a model turn.
See *Data binding* below and `spec/json-ui-data.md` § Reactivity.

---

## The universal `style` prop

There is exactly **one** universal prop: `style` — an optional inline-CSS declaration
string, declared once as `UNIVERSAL_PROPS` and folded into every component's schema, so
authors never restate it per component.

- `style` is a **plain CSS declaration list**, e.g.
  `"display: grid; grid-template-columns: 1fr 1fr; gap: 16px"`.
- The renderer parses it via `@fusedio/widget-sdk`: declarations split on `;`, property
  names camelCased, malformed declarations ignored, `--custom-property` names passed
  through literally.
- The parsed result is merged **over** the component's defaults — it overrides, never
  replaces, the component's base styling (e.g. `div` is a `min-width: 0` flex column, over
  which `style` merges).

### Styling rule: prefer the defaults

Every component ships **sensible default styling** (padding, spacing, layout, colors). The
rule for **all** JSON-UI authors — our agents and anyone else building a config:

- **Rely on the defaults.** Omit `style` in the common case. A config with no `style` should
  already look right — that is the design intent, and it keeps a **consistent look across
  every JSON-UI surface** (the app, the deployed bundle, parley).
- **Override only when explicitly needed.** Set `style` for a *deliberate* deviation, and
  because it merges over (never replaces) the defaults, change only the few properties you
  mean to — don't re-declare a component's whole box.
- Ad-hoc per-config styling drifts from the shared look; defaults are the contract. If a
  default is wrong for everyone, fix the **component's** default styling (so every author
  benefits), not each config.

This rule is also surfaced in the schema itself — the `style` prop's description (generated
into `components.json` from `_universal.ts`) carries it, so an agent reading the catalog sees
it without reading this spec.

---

## Layout

**`style`-driven only.** Layout is expressed entirely through the universal `style` prop
on `div` containers. Nest `div`s with flex/grid `style` for rows, columns, and grids;
reach equal-width columns with `div` + `"flex: 1;"`. There is no layout prop beyond
`style`.

**No conditional rendering — and why.** There is **no `visible` prop** and **no tab
primitive**. The Fused application has neither and lints component props with `.strict()`,
so a `visible` key would break paste-compatibility — OpenFused's component set is a strict
**subset** of the application's. Every node always renders. To change *what the user sees*,
drive a query's result through its `$param` inputs (e.g. a `dropdown` that filters the SQL)
rather than showing/hiding nodes. (Both the renderer and the universal-prop declaration
carry the no-`visible` invariant.)

---

## Data binding (authoring view)

A node is **data-bound** when its `props.sql` is a **non-empty DuckDB SQL string**. The
SQL is the node's *only* data source — there is no inline data in a config. At a glance,
the SQL may contain:

- `{{name}}` — the result of a UDF / endpoint, joined in by the host.
- `{{name?arg=$param}}` — the same, with query-string args (some `$param`-driven).
- `$param` — a value from the param store, inline-substituted into the SQL text.

A config with **no** data-bound node renders statically with no compute call.

**Which columns each chart family reads.** Charts read **fixed column names** from the
query result (not `x`/`y` props) — alias your `SELECT` accordingly:

| family | reads columns |
|---|---|
| `bar-chart`, `line-chart`, `stacked-bar-chart`, `stacked-area-chart` | `label`, `value` (+ optional `series`) |
| `donut-chart` | name, `value` |
| `scatter-chart` | `x`, `y` (+ optional `series`, `size`, `label`) |
| `heatmap-chart` | `x`, `y`, `value` (pivoted long→grid) |
| `metric` | first cell of the result (or the literal `value` prop) |
| `sql-table` | every selected column |

e.g. `select month as label, sum(revenue) as value from {{sales}} group by month`.

`text` and `dropdown` take an **optional** `sql` — they are data-bound only when it is
set (`dropdown` reads `value` / `label`; `text` reads a single cell).

> The **full** SQL contract — the `{{ref}}` query-string grammar, the `$param` inline
> text-substitution rules (app-compatible), UDF/`sql-runner` source resolution, the
> `{columns, rows}` row envelope, run-fresh semantics, caching, and the hardened-DuckDB
> security boundary — lives in the **host** spec `spec/json-ui-data.md`. It is **not**
> restated here: the package authors against it but does not implement it (the host
> resolves; the renderer only paints — [`rendering.md`](./rendering.md)).

---

## Actions & selection (the feedback authoring surface)

Widgets are also the human's **reply channel** in an agent conversation. Three authoring
primitives carry intent **beyond** input values. Per-component detail is in
[`widgets/button.md`](./widgets/button.md) and
[`widgets/video-review.md`](./widgets/video-review.md); this fixes the cross-cutting
authoring semantics.

- **`button`** — `props: { label, action, submit?, variant? }`. Pressing it reports an
  **action event** named `props.action`, carrying the full current param snapshot. It
  writes **nothing** to the param store (`writesParam: false`).
  - `submit: true` is **terminal**: the press settles the feedback session, the blocked
    `widget open` returns with that action name, and the page shows a completion notice. A
    *decision widget* is inputs + charts + one or more submit buttons.
  - `submit` falsy (the default) is **intermediate**: the session stays open and the agent
    sees an `action` event.
  - `variant` is visual prominence (`"primary"` / `"secondary"`). Outside any feedback
    channel a button renders but its press is a **no-op**.
- **Selection params** — a table's `selectionParam` + `selectionColumn` write the selected
  rows' key values (an **array**) into the param store; a chart's click param (where a
  component supports it) writes the clicked datum's category as a **scalar**. Selections
  are ordinary params: they ride in every feedback payload automatically, and a *scalar*
  click param can drive other queries through `$param` (in-widget drill-down).
  **Array/object params must never be referenced in SQL** — `$param` is text substitution,
  so only scalars are SQL-safe (`spec/json-ui-data.md`).
- **`video-review`** — timestamped feedback on an agent-made video, built for the parley.
  It writes the human's open notes to `param` as an **array** of `{t, text}` objects, and
  QA verdicts on past rounds to `qaParam` as an object map — both non-scalars, **never**
  referenced in SQL. It reports no action itself: pair it with a `button` for the explicit
  "send this round" signal. See [`widgets/video-review.md`](./widgets/video-review.md).

The exact prop schemas are component-owned (generated catalog — [`catalog.md`](./catalog.md));
this section fixes only the cross-cutting semantics. `button`, `video-review`, and `canvas`
are the three OpenFused-owned primitives **not** governed by app parity.

### `form` — submit-bundling

`form` is a container (`hasChildren: true`) that collects its descendant inputs into a
field store and broadcasts **on submit** (a descendant `button`), not while typing:

- `form` **with** a top-level `param` → on submit, all field values are bundled into a
  single JSON object broadcast to that one param.
- `form` **without** a top-level `param` → on submit, each field broadcasts to its own
  `param` individually.

Unlike the Fused application, charts/tables inside a form update **on submit**, not live
as you type — OpenFused has no client DuckDB to re-query mid-edit. Same config, same final
result, different timing (`spec/ui/json-ui-widgets-batch1.md`; [`widgets/form.md`](./widgets/form.md)).

---

## What authors do not write

- **No envelope / version / `$schema`** — the document is the root node.
- **No `visible`, no tabs, no conditional rendering** — subset of the app; drive visibility
  through `$param`.
- **No inline data** — a data-bound node's only data source is its `props.sql`.
- **No cross-tree param wiring outside `canvas`** — a widget tree sees only the `$param`s
  declared within itself; the dependency graph is local (`canvas` is the exception —
  edges carry param dataflow between nodes; `spec/json-ui-canvas.md`).
- **No SQL in the renderer** — SQL always resolves server-side (`spec/json-ui-data.md`).

---

## Cross-references

- [`catalog.md`](./catalog.md) — the 35-type catalog table, per-component prop summary,
  the single source of truth, and `components.json` generation (the hard type gate).
- [`rendering.md`](./rendering.md) — the render-time `{element}` contract, the registry,
  `_queryId` binding, the build-time zod replacement, `RenderTree`/`RenderNode`, and the
  static bridge / reactive flow that turns this config into painted React.
- [`widgets/`](./widgets/) — one spec per component type (why / expectation / exposed
  params), incl. [`button.md`](./widgets/button.md),
  [`video-review.md`](./widgets/video-review.md), and [`form.md`](./widgets/form.md).
- [`authoring.md`](./authoring.md)'s host counterparts:
  - `spec/json-ui-data.md` — the SQL `{{ref}}` / `$param` grammar, resolution, the row
    envelope, run-fresh, the hardened-DuckDB boundary, and caching (the data half).
  - `spec/json-ui-app.md` — the app's native render + per-project resolve daemon (the
    single viewer that consumes these configs).
  - `spec/json-ui-local.md` — the local workspace + parley (`widget open` / `widget push`
    / `widget watch`) that render the feedback surface above.
