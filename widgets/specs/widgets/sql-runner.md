# `sql-runner`

> Container that runs a named query once (props.name + props.sql) and exposes its result to descendant queries as {{name}}. The query is a server-side source, not a rendered output; children render normally.

## Why
`sql-runner` is a **container** that defines a named, server-side SQL source: `props.name` + `props.sql` register a local-view source the resolver runs ONCE, and any descendant query may then read its result as `{{name}}`. Authors reach for it to compute an intermediate result once and fan it out to multiple descendant `sql` bindings — instead of repeating (and re-running) the same query in each child. It produces no visual output of its own; it only lays out its children. It is a strict, paste-compatible **subset** of the Fused application's `sql-runner` (spec/ui/json-ui-widgets-batch1.md § Deferred: sql-runner).

## Expectation
- Renders a single wrapper element around `element.children`. The wrapper is **layout-transparent** — it imposes no box and just lays out children in place. `name`/`sql` produce no visual output.
- The renderer is a **pure passthrough**: the `{{name}}` binding is resolved entirely server-side, so this component carries no data logic, no loading state, and no error fallback in the renderer itself.
- **Server-side source semantics (resolver-owned, not this renderer):** the planner registers `name` as a local-view source — a third source tier ahead of the `udfs/` registry. The resolver runs `sql` ONCE, recursively, in a hardened DuckDB connection, exactly like a UDF source. Any descendant `sql` that reads `{{name}}` sees that result. A `$param` inside `sql` re-resolves every descendant query that reads `{{name}}`.
- `sql` may reference `{{udf}}`s and `$param`s. `maxRows` is a safety LIMIT appended to `sql` only when `sql` has no `LIMIT` clause (default 10000).
- `name` must be unique within the config and must not collide with a UDF name (server-side constraint enforced by the planner/resolver, not by this renderer).
- This component is NOT itself data-bound in the json-ui sense (it carries no `props._queryId`): its `sql` defines a *source*, not a *rendered* query, so the resolver does not stamp a `_queryId` onto the `sql-runner` node. Only descendant rendered nodes that read `{{name}}` are data-bound.
- Deliberate behavioural subset vs the Fused app: fewer props than the application's `sql-runner` (it exposes only `name`, `sql`, `maxRows`, plus the universal `style`); identical type + prop names + semantics.
- WHERE it renders: everywhere (not a map widget; no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `name` | `string` | — | Local view name descendants reference as `{{name}}`. Must be unique within the config and not collide with a UDF name. |
| `sql` | `string` | — | DuckDB SQL run once; its result is registered as `{{name}}` for descendant queries. May reference `{{udf}}`s and `$params` (a `$param` here re-resolves every descendant that reads `{{name}}`). |
| `maxRows` | `number` (optional) | — | Safety LIMIT appended to the SQL when it has no LIMIT clause (default 10000). |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over the component's default styles. |

- **Data-bound:** no (`sql` here defines a server-side named source, not a rendered query; no resolver-stamped `_queryId` on this node — only descendants reading `{{name}}` are data-bound).
- **Writes param:** no (`writesParam: false`).

## Notes
- ui-kit primitives: none — the renderer is a plain layout-transparent wrapper element that imposes no box.
- The universal `style` string is parsed (via `@fusedio/widget-sdk`) and applied onto the wrapper element.
- `hasChildren: true` — this is a container; children render normally and may read `{{name}}` in their own `sql`.
