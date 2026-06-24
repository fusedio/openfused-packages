# `task-board`

> The paperclip task-view as a single self-contained json-ui component: a list view, a
> kanban view, and a **delegation tree view** of one project's (or all projects') tasks, with all
> of their controls — search, status filter, group/sort, list/board/tree toggle, collapsible
> groups, and drag-to-change-status — held inside the component as client React state.
> Click-through (a task row → its detail; a root's widget-board link) rides the host's **generic
> `navigate(path)` capability** (`OpenfusedHost`, surfaces.md §11); surfaces with no host
> render the rows inert. Reads task rows through `{{ref}}` SQL over the
> `_core.task-management.read` cross-project UDF (read-only); mutates (drag-to-move, cancel,
> create) by firing `_core.task-management.update_status` (move/cancel) and
> `_core.task-management.create` (create) through the **generic event-triggered executor seam**
> (`bridge.udfs.execute` → the host `POST /api/udf-exec` route — surfaces.md §10, the
> same seam a `button`'s `executor` prop fires), then bumping a refresh param to re-resolve the
> read (mutate-then-refetch). The **4th OpenFused-owned primitive** (after `button`,
> `video-review`, `canvas`) — it is NOT in the Fused application, so it breaks paste-compatibility.
> It runs on a **control-plane consumer surface** (now external — Flow, `fusedio/flow` — where
> `_core.*` cross-project refs resolve); only the deployed-serve bundle, which has no `_core`
> project in scope, renders "unavailable." It works for AWS-backed projects too: the `_core` UDFs
> always execute on the local backend regardless of the requesting project's env.

## Why

`task-board` is the json-ui re-incarnation of a control-plane app's **task-view** (the
`TasksList` + `KanbanBoard` + `TaskTree` page mounted by `TasksPage` / `TasksContainer`; that
consumer is now external — Flow, `fusedio/flow`). An author reaches for it to drop
the whole task surface — list, kanban, and every control — into a widget config as a single
node `{"type":"task-board"}`, instead of the bespoke React page. Its role is a **stateful,
mutating display**: it reads live task rows and lets a human re-triage them (drag a card to
change status; create a task) without a model turn.

It is an **OpenFused-owned primitive**, the fourth after `button`, `video-review`, and `canvas`,
**not** governed by app parity — the Fused application has no task concept, so there is nothing
to be paste-compatible *with*. This is a deliberate parity break, owned by `spec/ui/json-ui.md`
§ Authoring & catalog and ADR 0001 (handoff packet `adr/0001-task-board-spec-owned-primitive.md`).
It is also the first widget that **writes** through the resolve plane (ADR 0002), and the first
that iterates a collection to render per-row / per-lane layouts. Both are knowing extensions of
the platform, not ports — see `internal-requirements.md` (collection rendering) and
`spec/json-ui-data.md` (the read-only-plane write exception).

Precedent components to read alongside this spec: `metric.md` / `sql-table.md` (the
`useDuckDbSqlQuery` `{{ref}}` read shape), `button.md` / `video-review.md` (how an
OpenFused-owned primitive is added and how an interaction leaves the widget).

## Expectation

### Where it renders (the unavailable state)

- **Control-plane consumer surfaces only — but NOT backend-gated.** Task state lives under
  `~/.openfused/app/` and is reached by the `_core.task-management` UDFs. The `_core` project is
  a local project, so its UDFs **always execute on a LOCAL compute backend (the consuming host),
  regardless of the requesting project's configured env.** So the task-board functions for
  AWS-backed (and any other) projects exactly as it does for local ones — there is **no
  non-local-backend gate**. The locality requirement is about the *consuming host*, not the
  project's backend.
- The component is therefore available on the surfaces that **have a control-plane host + an
  injected `udfs` executor**:
  - **A control-plane consumer host** (now external — Flow, `fusedio/flow`) — available.
  - **Parley** (`widget push` / `widget watch` / `widget open`, the `widget-host/` viewer) —
    **available** when the host wires the `udfs` executor: it then rides the local tasks UDFs +
    `udfs` executor.
  - **Deployed-serve bundle** (`widget.html`) — **unavailable**: a public JSON-UDF URL has no
    control-plane host, no local task store, and no injected `udfs` executor. The component
    renders a single `EmptyState`-style **"Task board unavailable here"** card and performs no
    read and no write. This is the same render-everywhere-but-degrade discipline the map widgets
    use for the deployed bundle (`internal-requirements.md`).
- **Detection** is by capability, not by backend: the component is unavailable exactly when the
  bridge carries no real `udfs` executor (the `createStaticBridge` no-op stub — `surfaces.md`
  §10 / `ui-architecture.md` §13). The deployed bundle keeps that stub; a control-plane host
  injects the real one. (The exact capability probe is a build-time detail, owned by the
  component + the consuming host.)

### View-state model (all client React state)

- The component holds **all** view chrome in local React state, exactly as `TasksList` does
  today — the read query returns the full task array and every control filters/sorts/groups
  that array client-side (instant, no per-keystroke re-resolve):

  | state | values | default |
  |---|---|---|
  | `viewMode` | `"list" \| "board" \| "tree"` | `"list"` |
  | `search` | string (matched against `title` + `description`, via `useDeferredValue`) | `""` |
  | `statuses` | `TaskStatus[]` (multi-select status filter; empty = all) | `[]` |
  | `groupBy` | `"none" \| "status" \| "assignee"` | `"status"` |
  | `sortField` | `"updated" \| "created" \| "title" \| "status"` | `"updated"` |
  | `sortDir` | `"asc" \| "desc"` | `"desc"` |
  | `collapsedGroups` | `string[]` (collapsed group keys, list view only) | `[]` |

  This is the `TasksListViewState` shape lifted verbatim from a consuming control-plane app's
  `TasksList` component (now external — Flow, `fusedio/flow`: `src/ui/components/TasksList.tsx`).
- **Persistence to `localStorage`.** The view state is persisted under a key derived from a
  `viewStateKey` (defaults merged on load, write-through on every change), mirroring
  `TasksList`'s `openfused:tasks-view:${viewStateKey}`. The key is **per-(project, surface)**
  (GRILL #5) — it derives from the `project` prop + the surface id, so the global board
  (`project: "all"`) and a project-scoped tab keep **separate** saved view prefs (toggle / filter
  / sort / group / collapse), matching today's native behavior and the dual global+project scope.
- Sorting uses a fixed `STATUS_ORDER` for the `status` sort field and lane order; `localeCompare`
  for `title`; epoch-ms for `created`/`updated`. The status-filter chip strip (`FilterBar`),
  the group/sort popover, and the collapse toggles all read and patch this one state object.

### List view

- Renders grouped sections of rows. Grouping: `none` (one ungrouped block), `status` (sections
  in `STATUS_ORDER`, each headed by a `StatusIcon` + label + count), or `assignee` (sections by
  `agentId`, an "Unassigned" bucket for `null`, resolved to a display name). Each group header is
  a `CollapseToggle`; collapsing hides the section's rows and records the group key in
  `collapsedGroups`.
- Each row shows the task's `taskLabel(number)` ("TASK-01"), title, status, assignee identity,
  and a relative-time stamp; a "live" pulse when any of `task.runs[]` is in a started state
  (the `live-tasks` derivation).
- **Click-through to a task detail (DECIDED — GRILL #2; AS-BUILT).** A widget has no router, so
  click-through rides the **generic host capability** `OpenfusedHost.navigate(path)`
  (`packages/widgets/src/widgets/openfused-host-context.ts`; surfaces.md §11) — the same general
  seam any widget uses, NOT a task-specific callback and NOT the universal `FusedWidgetBridge`
  (navigation is an app/router-only concern). The widget owns the **route shape** via two
  overridable template props — **`taskHref`** (default `/tasks/:taskId`) and **`boardHref`**
  (default `/projects/:project/widget/:stem`) — interpolates the ids, and calls `host.navigate(path)`.
  A **control-plane consumer host** (now external — Flow, `fusedio/flow`) fills `navigate` once at
  the root (its `OpenfusedHostProvider`, inside the router) with a react-router push. **Inert
  fallback (the affordance check):** when no host provides
  `navigate` (the deployed-serve bundle / parley standalone), the open callbacks are `undefined`, so
  every row renders its **inert variant** — no click handler, no pointer cursor, and the board link
  is **hidden** (surfaces.md §11.2: render the non-linking variant, never a crash). A click that ends
  a drag (the @dnd-kit pointer activation distance, kanban only) does not navigate. List, board, and
  tree rows share the same gated `onOpenTask`/`onOpenBoard` view seam, derived from `host.navigate`.

### Kanban view

- Lanes are status columns in `STATUS_ORDER` by default; **group-by-assignee** swimlanes by
  agent instead (no status-move DnD in that mode). High-volume boards auto-collapse the cold
  lanes (`completed` / `failed` / `cancelled`) above a threshold, unless an explicit status
  filter is active.
- **Drag-to-change-status** via `@dnd-kit` (the dep moves into the widgets package — see
  `internal-requirements.md` and `spec/ui/ui-architecture.md`). On drag end:
  1. Resolve the drop target lane to a `TaskStatus` (`resolveKanbanTargetStatus` — the `overId`
     is either a lane id or a hovered card whose status is inherited).
  2. Apply the **human-allowed-transition guard** (`isHumanAllowedTransition`): only
     `pending↔todo` and "cancel anything" are hand-settable; every other lane is reached by an
     agent run, not by hand. A refused drop is a **snap-back** — the card returns to its lane,
     no write is issued, and a brief notice is shown. (This is the advisory **client mirror** of
     the server's authority; the server / CLI still has final say and refuses anything else — the
     guard never substitutes for the server check.)
  3. An allowed drop issues a write (below) and, in v1 mutate-then-refetch, the card stays put
     until the refetch lands (visible latency — ADR 0002, accepted for v1).

### Tree view (AS-BUILT)

- A **delegation tree** ported 1:1 from a control-plane app's `TaskTree` (now external — Flow,
  `fusedio/flow`: `src/ui/lib/taskTree.ts` + `src/ui/components/TaskTree.tsx`). The `parentId`
  graph is the
  **skeleton** (indentation + collapse/expand caret), and `blockedBy` is an **annotation** — a
  "waiting on TASK-NN" badge (only for blockers not yet `completed`) + a hover/focus highlight of a
  node's blockers and dependents. The two graphs are never conflated: a `blockedBy` edge never moves
  a node.
- The forest is built by the pure `buildTaskForest` (`task-tree.ts`) from the **project-scoped full
  set** (not the flat, sorted list), so the skeleton is complete: roots order newest-first, children
  oldest-first; a task whose parent is absent renders as a root (orphan-as-root); the depth walk is
  cycle-safe (a visited guard). Search + status filter through `filterTaskForest`, which keeps the
  **ancestor chain** of any match visible (a matched child never orphans its parents). The shared
  empty state gates on the (ancestor-kept) forest in tree mode, not the flat list.
- A row shows the same vocabulary as the list row (status dot, `taskLabel`, title, live pulse,
  assignee identity, run count, relative time). A **root-only** widget-board roll-up renders the blue
  "Open board" link (AppWindow icon + stem name) for the first `Feedback: <stem>` found anywhere in
  the subtree → `onOpenBoard`. Collapse state reuses the board's `collapsedGroups` set (tree node ids
  and list/board group keys never collide).

### Create task (GRILL #1)

- The "New Task" control opens a **widget-owned modal** — a dialog/overlay the component renders
  **itself**, in a portal scoped to its own viewport, using the ui-kit `Dialog` primitive. It is
  **not** the host's `DialogContext` (that would couple the widget to an app context it must not
  import) and **not** an inline-in-flow form (the decision is an overlaid modal, not a panel
  spliced into the list/board). The board owns the open/close state as internal React state, like
  every other control.
- The modal form has: a **title** field (the task prompt, a `Textarea`) and an **agent picker**
  (a select of available agents → `agentId`, optional). Submit fires the executor write seam
  (see § Writes):
  1. `bridge.udfs.execute("_core.task-management.create", {id, project, title, description})`
     where `prompt` maps to both `title` and `description` — a client-generated `id` makes
     the create idempotent,
  2. **mutate-then-refetch** — on the successful ack, close the modal and bump the `ofTasksRev`
     refresh param so the read query re-resolves and the new task appears (no optimism in v1 —
     ADR 0002).
- **v1 creates the task ROW only — it does NOT dispatch an agent run.** Create writes the new
  task to the store (via `_core.task-management.create`); the human dispatches the run from the
  task detail page afterward. **Not yet wired through `_core`:** `agentId` (assignee-on-create
  is not yet a parameter of `_core.create`, so a create via the board lands unassigned).
  This keeps the widget's write surface to "mutate task state," not "run an agent."
- The agent-picker's option source is a build-time detail (the consuming host's available-agents
  list, reached as a host capability or a second read ref) — flag during implementation; it does
  not change the create contract above.

### Keyboard shortcuts (GRILL #3)

- The board **keeps** the native task-view's keyboard shortcuts, **inside the widget**: while the
  component is mounted it attaches **`document`-level** key listeners and **removes them on
  unmount** (a `useEffect` whose cleanup detaches them). The shortcuts are: **`C`** → open the
  create-task modal (GRILL #1), **`⌘K` / `Ctrl+K`** → the command palette / equivalent quick
  action. Listeners are ignored while a text field (the search `Input`, the create modal's
  `Textarea`, the agent picker) is focused — typing "c" in search must not open the modal.
- **This is an accepted control-plane-surface coupling.** A `document`-scoped listener is global,
  unlike the wrapper-scoped `onKeyDown` discipline `video-review` uses; it is acceptable here
  because the task-board only mounts on the control-plane consumer surfaces (a host + the parley)
  — on the deployed-serve bundle it shows "unavailable" and never mounts the listeners. The
  mount/unmount
  lifecycle is the guard against leaking listeners across views. A second mounted board (unusual)
  sharing the same `document` shortcuts is a known edge — last-mounted wins; flag if it arises.

### Reads (seam ④ + ①)

- The component is **data-bound**: it reads task rows with `useDuckDbSqlQuery({ sql, queryId })`
  over a `{{ref}}` SQL prop, the same resolve shortcut `metric` / `sql-table` use. The default
  read SQL (GRILL #4) is a **read-only `SELECT *`** over the `_core.task-management.read`
  cross-project ref, **with no LIMIT** (the board filters/sorts/groups client-side, so it needs
  the full set). It carries one ref kwarg — `rev`, bound to the `ofTasksRev` refresh param (see
  § Writes), an opaque re-resolve nonce the read UDF ignores:

  ```sql
  SELECT * FROM {{_core.task-management.read?rev=$ofTasksRev}}
  ```

  The read SQL is **overridable via `props.sql`** (an author can add a `WHERE` / projection), but
  the **seam-① row columns are required** — the UDF returns them and an override must keep them
  (the kanban/list logic reads them by name), AND an override **must keep the `?rev=$ofTasksRev`
  kwarg** or the board stops re-resolving after a write. Writes do **not** ride this query (it is
  read-only); they fire the `_core.task-management.update_status` / `_core.task-management.create`
  UDFs through the executor seam (§ Writes).

  The `_core.task-management.read` UDF reads `~/.openfused/app/state.json` directly via Python
  stdlib and returns the full task-shaped row set. It always runs on the **local backend** (the
  `_core` project is a local project), so the read works for AWS-backed projects too. This
  component's contract is only the *ref name*, the *row shape* (seam ①), and the *default SQL*
  — not the UDF body internals.
- **Row shape (seam ①)** — derived from the `Task` type (a consuming control-plane app's
  `src/ui/types/index.ts`; now external — Flow, `fusedio/flow`):
  `id` (string), `project` (string), `number` (int → rendered "TASK-01"), `title`,
  `description`, `status` ∈ `{pending, todo, in_progress, blocked, completed, failed,
  cancelled}`, `agentId` (string | null), `createdBy`, `createdAt`, `updatedAt` (ISO 8601),
  **`parentId`** (string | null — the delegation-tree skeleton edge) and **`blockedBy`** (string[] —
  the dependency annotation; both emitted camelCased by `list_tasks` via the `TaskRecord` aliases,
  coerced defensively by `toTask` — `blockedBy` accepts a real array or a JSON-string list column),
  `runs[]` of `{id, status, createdAt, finishedAt, costUsd, usage}`. The read UDF additionally
  **pre-derives two scalar top-level columns** so the live-pulse never has to scan the nested
  array client-side: **`isLive`** (bool — true when any run is in a started state) and
  **`liveRunCount`** (int — how many). `runs` itself arrives as a nested array column (cost /
  detail surfaces read it) and is **never** referenced in `$param` SQL (an array, like every
  selection/feedback value — `spec/json-ui-data.md`); `isLive` / `liveRunCount` are plain scalars
  and may be filtered/sorted in `props.sql` overrides.
- `project` prop scoping: `project: "<name>"` resolves the board under that project's context;
  `project: "all"` (or unset → all) needs the consuming host's **global resolve context** — the
  per-project resolve daemon (`POST /api/projects/:name/widget-data`) has no project-less mode
  today, so the global board is plumbing the consuming host provides (DESIGN decision 9; owned by
  the consuming host — now external, Flow `fusedio/flow` — consumed here as a contract).

### Writes (the executor seam — seams ③ + ⑤)

The json-ui resolve plane is read-only by construction, so a write rides the **generic
event-triggered executor** (`bridge.udfs.execute` → the host `POST /api/udf-exec` route —
surfaces.md §10, the same seam a `button`'s `executor` prop fires), **not** the read
query. The board fires the appropriate `_core.task-management` UDF, with the mutation passed
as a flat overrides map:

  1. **Fire the executor** (seam ⑤), one `_core` UDF per op (typed kwargs, ADR 0009; cache
     pinned off):
     - drag-to-move → `bridge.udfs.execute("_core.task-management.update_status", {id, status})`
       (a drag into the `cancelled` lane is `status: "cancelled"` — the `isHumanAllowedTransition`
       guard allows `to === "cancelled"`),
     - create → `bridge.udfs.execute("_core.task-management.create", {id, project, title, description})`
       — the composer's `prompt` maps to both `title` and `description`; a client-generated `id`
       makes the create idempotent. When the composer picked an assignee, a follow-up
       `bridge.udfs.execute("_core.task-management.assign", {id, agent_id})` chains off the create
       ack (best-effort: a failed assign leaves the created task unassigned, not failed),
     - reassign → `bridge.udfs.execute("_core.task-management.assign", {id, agent_id})`.
     The host inlines those overrides as ref-kwarg **literals** (cache pinned off) and resolves the
     `_core` UDF through the ordinary cross-project ref path.
  2. **The `_core` UDF applies the change** — it reads/writes `~/.openfused/app/state.json`
     directly via stdlib and returns the ack envelope the executor reads back.
  3. **Mutate-then-refetch** — §11's executor is **fire-and-forget**, so the board wires the
     prescribed `$param` re-read: on a successful ack it **bumps the `ofTasksRev` refresh param**,
     which re-resolves the read-only read query → fresh feed. On a write **error** the board does
     **not** bump `rev` (it keeps the true pre-write state — the moved card snaps back) and
     surfaces the error. **v1 has no optimism and no polling** — a card reflects a move only once
     the refetch lands, and a background agent write is not seen until the next user-triggered
     refetch (ADR 0002; the data layer is built so polling / SSE invalidation can be added later
     without rework).
- **Concurrency** is delegated to the task store as the single source of truth.
- **The dormant `udfs`-bridge methods.** The earlier target design routed writes through
  `requestReexecute` / `subscribeOutput` / `getOutputSnapshot`; those bridge methods remain no-op
  stubs in `static-bridge.ts` and the board **does not** use them. An even earlier interim (PR
  #156) folded writes *into the read query* via a `mutations` ref kwarg; that read-SQL-path fold
  is **superseded** — the read is now strictly read-only and writes ride the §11 executor above.
  See `task-board.tsx` (outer `TaskBoard` — `fireMutation` / `onMoveTask` / `onCreateTask`) and
  `surfaces.md` §10 + `spec/json-ui-data.md` § Task-board data.

### Host boundary (seam ②)

- The renderer is split into a **pure inner view** and the data/bridge wiring, so the inner view
  is testable and surface-agnostic. The inner view's boundary is:

  ```ts
  TaskBoardView({                    // the exported pure inner view
    tasks: Task[],
    loading: boolean,
    error?: string,
    project: string,                 // "<name>" | "all"
    defaultView, defaultGroupBy,
    onMoveTask(id, status): void,
    onCreateTask(input): Promise<boolean>,
    onOpenTask?(id): void,           // derived from host.navigate — undefined → inert rows
    onOpenBoard?(project, stem): void,
  })
  ```

  **All view chrome** (list/board/tree toggle, search, filter, group/sort, collapse, the @dnd-kit
  drag machinery + the `isHumanAllowedTransition` guard, the create modal's open/close, the
  mounted keyboard listeners) is **internal React state** of `TaskBoardView` — it is not in this
  prop list. The outer component (the `defineComponent` renderer) owns the read (`useDuckDbSqlQuery`
  → `tasks`/`loading`/`error`), maps `onMoveTask`/`onCreateTask` onto the `bridge.udfs.execute`
  executor write seam above (then bumps `ofTasksRev` to refetch), and **derives**
  `onOpenTask`/`onOpenBoard` from the generic `OpenfusedHost.navigate` (`useOpenfusedHost`) plus the
  `taskHref`/`boardHref` templates — both `undefined` when the host has no `navigate`, so the views
  render their inert (non-linking) rows. The assignee chip shows the raw `agentId` (resolving it to a
  name would need the consuming host's `/api/agents` roster — out of scope for the routing-only host seam). When
  the bridge carries no real `udfs` executor (the deployed-serve bundle — see § Where it renders) the
  outer component renders the unavailable card and never mounts the view; the project's backend never gates it.

### ui-kit primitives it needs

- From `@fusedio/ui-kit` (`@kit`): `Button`, `Input`, `Popover` (+ `PopoverTrigger` /
  `PopoverContent`), `Dialog` (the **widget-owned** create-task modal — GRILL #1 DECIDED, not the
  host's `DialogContext`), `Textarea` (the create-task prompt field). Plus the small internal bits the task-view already factors out and
  that move into the widgets package with it: `StatusIcon`, `Identity` (assignee chip),
  `FilterBar` (active-filter chip strip), `CollapseToggle`. The widgets package gains a
  `@fusedio/ui-kit` dependency it does not have today (`spec/ui/ui-architecture.md`, ADR 0001).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `project` | `string` | `"all"` | Project name to scope the board to, or `"all"` for every project. `"all"` needs the consuming host's global resolve context. |
| `sql` | `string` (optional) | `SELECT * FROM {{_core.task-management.read?rev=$ofTasksRev}}` | Read SQL over the `_core.task-management.read` cross-project ref (read-only). The default carries the `rev` refresh ref kwarg bound to the `ofTasksRev` param, which the board bumps after each write to re-resolve (mutate-then-refetch). An override **must keep** that `?rev=$ofTasksRev` kwarg (or the board stops refreshing after writes) AND the seam-① row columns (the list/kanban logic reads them by name). Writes do **not** ride this query — they fire `_core.task-management.update_status` / `_core.task-management.create` through the executor seam (§ Writes). |
| `defaultView` | `enum("list","board","tree")` (optional) | `"list"` | Initial view before any persisted `localStorage` state: list, kanban board, or the `parentId` delegation tree. |
| `defaultGroupBy` | `enum("none","status","assignee")` (optional) | `"status"` | Initial grouping before persisted state. |
| `taskHref` | `string` (optional) | `"/tasks/:taskId"` | Route template for a task-row click — `:taskId` is interpolated, then handed to the host's generic `navigate(path)` (`OpenfusedHost`, surfaces.md §11). Rendered only when a host provides `navigate` (a control-plane consumer surface); off-host the row is inert. |
| `boardHref` | `string` (optional) | `"/projects/:project/widget/:stem"` | Route template for a root task's widget-board link — `:project` and `:stem` are interpolated, then handed to `host.navigate(path)`. The link is hidden when the host has no `navigate`. |
| `style` | `string` (optional) | — | Universal inline CSS declaration string, parsed and merged over defaults. |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (the read-only `sql` over `{{_core.task-management.read?rev=$ofTasksRev}}` → the seam-① rows).
- **Writes param:** yes — `writesParam: true`. The component writes the **`ofTasksRev`** refresh
  param — a string-encoded re-resolve nonce. It is **not** a mutation payload: writes ride the
  `bridge.udfs.execute` executor seam (the mutation travels as executor overrides — see
  § Writes), and `ofTasksRev` is merely bumped after a successful write to re-resolve the
  read-only read query. It is carried as a **strict** `rev` ref kwarg of the read SQL
  (`?rev=$ofTasksRev`); the outer component keeps it set from mount (`"0"`) so the strict ref arg
  never errors the read.

## Notes

- **Single source of truth.** Add this widget the same way as any other: write
  `packages/widgets/src/widgets/task-board.tsx` (`defineComponent({component, props, description,
  hasChildren: false})` + `writesParam: true`), register it in the `componentDefs` barrel
  (`packages/widgets/src/widgets/index.ts`), and **regenerate `components.json`** (`pnpm --filter
  @fusedio/widgets generate`) so the hard type gate (`src/openfused/widgets/validate.py` via
  `components.json`) accepts `type:"task-board"` for free. No parallel Python list. The catalog
  count is **34** (catalog.md, overview.md, `spec/ui/json-ui.md`) — the regeneration of
  `components.json` when the `.tsx` lands is what makes the runtime type gate match these specs.
- **`writesParam` lint.** The generator throws if a component exposes both `param` and
  `defaultValue` without `writesParam: true`. This component's written param is the `ofTasksRev`
  refresh nonce (an internal re-resolve target, not an author-set `param` input), and the schema
  carries `writesParam: true` so the lint is satisfied. The mutation itself is **not** a written
  param — it travels as `bridge.udfs.execute` overrides (§ Writes).
- **Collection rendering is new.** No existing widget iterates a collection to render per-row /
  per-lane layouts; this is the first. The render-time `{element}`-single-prop contract still
  holds — `TaskBoard` builds its own internal markup from the resolved rows, it does not render
  child `UINode`s (`hasChildren: false`).
- **Phased migration** (DESIGN decision 10 / ADR 0001, owned by the consuming host's team; here
  for context):
  1. Build `task-board` + the executor write seam (`bridge.udfs.execute` → the host `/api/udf-exec`
     route) **behind** the existing native page (coexist, no route change). Read/write via
     `_core.task-management.*` UDFs.
  2. Wire it into the **project-scoped** Tasks tab first (cleanest resolve fit), then the
     **global** `/tasks` page (needs the global resolve context / host-project selection).
  3. **Flip** the consuming host's task route to render the widget, then **delete** the native
     `TasksList` / `KanbanBoard` / `TaskColumns`. The flip is **gated by reactivity**: v1
     mutate-then-refetch is visibly sub-parity (drag latency; stale on background writes), so
     expect to live in "coexist" until optimism + polling/SSE land (ADR 0002). (This migration is
     now carried out in the external Flow app, `fusedio/flow`.)
- **Comment / feedback overlay (GRILL #6).** The parley is **enabled** for the task-board (when a
  host wires the `udfs` executor it gets the board and its `udfs` executor; it is **not** an
  "unavailable" surface). The parley comment overlay (`comments.md`) anchors comments to
  `[data-ofw-node]` markers; on an interactive,
  internally-scrolling, drag-enabled board, **v1 anchors at the board ROOT node only** — the board
  **opts out of per-card comment anchoring** for v1 (per-card pins over a drag surface are a
  follow-up). A human can comment "on the board"; pinning a comment to an individual card is out
  of v1 scope.
- Cross-references: `catalog.md` (the row + parity note), `spec/ui/json-ui.md` § Authoring &
  catalog (the 4th spec-owned primitive), `spec/json-ui-data.md` (the read-only-plane write
  exception + the `$param`-vs-array/object rule), `surfaces.md` §10 (the generic
  event-triggered executor — the board's write seam — + the host resolve context), and the
  handoff ADRs `0001` / `0002`.
