# `agent-detail`

> The per-agent interface as a JSON-UI widget — **Overview** (config edit + stats),
> **Runs**, and **Instructions** (prompt editor) for one agent — backed by the
> packaged `_core.agents-management` CRUD UDFs. Moves the app's former
> hand-built `AgentDetailPage` into a widget (the same play `task-board` made for
> the task surface). Fused-owned; not governed by app parity.

## Why

The agent roster is a first-class Fused concept with packaged `_core`
UDFs. Rendering the per-agent interface as a widget lets the same surface be
authored, resolved, and edited through the `{{ref}}` + executor seam instead of
bespoke app REST — consistent with `task-board`, and reusable wherever the widget
renderer runs (the app today).

## Where it renders

App-host surfaces only (the app's `/agents/:slug`). Like `task-board`, it reads
and writes through the host's resolve daemon + udf-exec proxy; the deployed-serve
bundle (no app host, no `_core` shared-workspace resolution) renders the
unavailable/empty state.

## Data

- **Read (resolve plane, one `_queryId`)** — `props.sql` default
  `SELECT * FROM {{_core.agents-management.read?slug=$agentSlug}}` returns the one
  agent row (id, slug, name, title, role, description, adapter, model, prompt,
  createdAt). `$agentSlug` is host-bound as a resolve **param** (from the
  `/agents/:slug` route) — passed as a `$param`, NOT interpolated into the ref, so a
  slug with ref-grammar chars can't break parsing. The upstream `read` UDF is
  upstream-owned and takes no refresh kwarg; the widget consumes it as-is.
- **Runs (executor read, lazy)** — on first open of the Runs tab,
  `bridge.udfs.execute("_core.task-management.read", {})` returns every task
  (enriched with `runs`); the widget filters to `agentId === <this agent>` and
  flattens to run rows newest-first. A second resolve-plane query isn't available
  to a single-node widget, so runs ride the executor.
- **Save (executor write, mutate-then-reflect)** — Overview Save and Instructions
  Save fire `bridge.udfs.execute("_core.agents-management.update", {id, name, title,
  role, description, adapter, model, prompt})`. The `update` UDF **returns the
  patched record**, which the widget reflects into local state — the view updates
  with no re-resolve (the upstream `read` has no refresh kwarg). A fresh resolve (a
  new agent / navigation) supersedes the local copy; a failed write surfaces inline
  and does not reflect.

## Props

| prop | default | purpose |
|---|---|---|
| `agentSlug` | `""` | the agent to show (slug/id); host-bound from `/agents/:slug` and passed to the read ref as the `$agentSlug` resolve param |
| `sql` | the `_core.agents-management.read` ref above | read SQL for the one agent row (the `$agentSlug` param is host-bound) |
| `adapters` | `[]` | adapter options (`{id, label, models:[{id,label,default}]}[]`) for the Overview config dropdowns — host config the app **injects at render** (the client-side `/api/adapters` catalog), not a `_core` entity |
| `taskHref` | `/tasks/:taskId` | route template for a Runs-row click → `OpenfusedHost.navigate`; inert when no host provides navigate |

## Tabs

- **Overview** — editable name / title / description / adapter (dropdown from
  `adapters`) / model; on an adapter change the model resets to that adapter's
  `default: true` model (else empty, the "default" option). Save persists via
  `_core.agents-management.update`. Read-only stats grid: Adapter, Model, Runs count
  (from the Runs read), Created (from the row). `role` is **not** editable (the
  control was removed) but is preserved on save.
- **Runs** — the agent's runs (filtered by `agentId`), each linking to its task.
- **Instructions** — the prompt editor (a `Textarea`); Save persists the prompt.

## Notes / deferred

- `agent-detail` writes through the resolve/executor seam like `task-board`; it is
  the second Fused-owned widget to do so.
- Not yet wired: create/delete/clone/reset of agents (the widget edits an existing
  agent only). `role` is preserved on save but has no edit control (deliberately
  removed). Clearing `model` back to the adapter default isn't expressible — the
  upstream `update` treats an empty field as "leave unchanged".

See `widgets/task-board.md` (the sibling pattern), `spec/json-ui-data.md`, and the
consuming control-plane app's render / resolve / host surface (the agent-detail
container, shared host resolution, and task assignment) — now in fusedio/flow.
