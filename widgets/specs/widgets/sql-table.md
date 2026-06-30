# `sql-table`

> Table rendered from a DuckDB SQL query. Set selectionParam + selectionColumn to let the human multi-select rows by clicking: the selected rows' selectionColumn values are written to the param as an ARRAY (feedback for the agent — never reference an array param in SQL).

## Why
`sql-table` paints rows from a host-resolved DuckDB query as a tabular display — the workhorse for showing UDF/endpoint output as a grid. Reach for it to surface multi-column result sets with optional client-side sort/filter, and (via the Fused feedback extension) to let a human multi-select rows whose chosen-column values are broadcast back to the agent as a param. Role: **display** (data-bound source) with an optional **input/feedback** facet (row selection). App-parity: a strict, paste-compatible **subset of the app's `sql-table`** (identical prop names/types/semantics, fewer props) — it is the rename of fused's legacy `table`; `selectionParam`/`selectionColumn` are an Fused feedback extension layered on top of the app contract.

## Expectation
- Renders a `Card` (titled by `title`) wrapping a state machine: **no-sql → loading → error → empty → ready**. Ready state renders the dumb ui-kit `DataTable` primitive (scroll container, sticky header, optional sortable headers, optional per-column filter inputs, selectable rows). Identical rendering to the app's AG-Grid is NOT required; identical config behaviour IS.
- **Data-bound:** the `sql` prop carries the DuckDB query (`{{udf_name}}` / `$param` placeholders). Rows/columns come from the SDK `useDuckDbSqlQuery` (passed the resolved sql, its query id, and `maxRows`, and enabled only when sql is present), whose result is `{ rows, columns: string[], loading, error }`. Columns are taken from the result `columns`; if empty, fall back to `Object.keys(rows[0])` (the first row's keys). Each result column → a table column, each row → a table row.
- `maxRows` is a **query-side safety LIMIT** appended by the SDK hook when the SQL has no `LIMIT` clause (app default 500) — NOT a post-fetch slice.
- Cell formatting: `null`/`undefined` → `""`; `bigint` → its string form; objects → `JSON.stringify` (falling back to a plain string conversion on failure); everything else → its string form. Mirrors the app's cell-value formatting.
- Sort + filter are **local view state** over the SDK rows (the light analogue of AG-Grid client-side sort/filter): clicking a sortable header sets/toggles `asc`/`desc` (numeric pairs compared numerically, else `localeCompare` with `numeric: true`); filter inputs case-insensitively substring-match the rendered cell text. Gated by `sortable` (default true) / `filterable` (default false).
- **Selection (input facet):** active only when BOTH `selectionParam` and `selectionColumn` are non-empty strings. Clicking a row toggles its `selectionColumn` value's membership; the param store receives the **ARRAY** of selected rows' `selectionColumn` values (multi-select, no modifier keys). Membership test uses `===` plus `Object.is` (catches `NaN`). Seeded with `defaultValue: []` and `broadcastDefaultValue: false` — the param stays untouched until the first click. Selected rows render highlighted; the hook re-renders to track external param writes too. The written value is an **array** → it is feedback for the agent and **must NOT be referenced in SQL** (`$param` is text substitution; json-ui-data.md).
- Shows an optional row-count badge ("N rows") above the table when there are results — not a prop.
- Guards/edge cases: empty `sql` → `EmptyState "No query"`; `loading` → `LoadingState`; `error` → in-card `ErrorState` (one failing query never blanks the dashboard); no columns or no view rows → `EmptyState "No results"`. Hooks run unconditionally above the state-machine branches.
- Deliberate app subsets (paste without error, simply ignored): the AI-host props (`aiBuilderMode`, `aiPanel`, `showEditor`, `editorPosition`, `editorCollapsed`, `editorHeight`) are NOT reproduced; the legacy fused `limit` prop is removed (replaced by `maxRows`). The universal `css` is read off `style`.
- **Where:** renders everywhere (no native-app restriction).

## Grouping
Rows can be organised into a collapsible hierarchy driven entirely by **designated columns of the single SQL result** (no second query). Two **mutually-exclusive** modes:

- **Group-by-column** (`groupBy`): a column name, or an array of names for nested grouping. The widget synthesises a **header row per distinct value combo** with the group value placed in the group column; the matching data rows nest beneath it. An optional `aggregates` map (column → `sum` / `count` / `avg`) computes a rollup shown on each header row over **that header's descendant leaf rows** (`sum`/`avg` coerce values to numbers; `count` counts leaves); columns that are neither a group column nor an aggregate render **blank** on header rows. The named columns must exist in the SQL result.
- **Parent/child master-detail** (`idColumn` + `parentColumn`, both required together): an adjacency list over the result rows. **Real data rows act as headers** — a row referenced as a parent becomes an expandable parent of the rows whose `parentColumn` matches its `idColumn`, to arbitrary nesting depth. A row whose `parentColumn` is null, empty, or points at no existing id is a **root**. Self-referential / cyclic parents are made roots and never loop.

`groupBy` takes **priority** if both modes are (mis)configured at once. With neither prop set the widget is ungrouped (see Expectation).

Behaviour:
- Groups render **expanded by default**. Each header / parent row carries a chevron that toggles collapse; a collapsed group hides its entire subtree. **Collapse state is local widget view-state — it is NOT a param** and is never broadcast.
- **Sorting operates within groups**: the `sortable` sort applies to sibling rows under each parent, and the hierarchy (header → its leaves) is preserved — rows are never globally re-flattened across groups.
- **Filtering applies to the leaf/data rows before grouping** (the engine does not prune the resulting tree). In **group-by-column** mode headers are derived only from the rows that survive the filter, so no empty synthesized groups arise. In **master-detail** mode a row is shown whenever it survives the filter: a surviving parent whose descendants were all filtered out still appears (a header with no visible children), and a surviving row whose parent was filtered out is promoted to a root (consistent with the unmatched-parent → root rule).
- Header / parent rows are **not row-selectable** (the selection facet stays on leaf rows); collapse and selection are independent.

**Backward-compatibility:** with no grouping prop set the widget behaves exactly as the ungrouped spec above. Grouping adds no param and no input facet — `components.json` is unchanged and `isInput` stays `false`.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `sql` | `string` (required) | — | DuckDB SQL with `{{udf_name}}` and `$param_name` placeholders; each result column → a table column, each row → a table row. |
| `title` | `string` | — | Table title displayed above. |
| `sortable` | `boolean` | `true` | Allow sorting rows by clicking column headers. |
| `filterable` | `boolean` | `false` | Show filter inputs below column headers. |
| `maxRows` | `number` (int, positive) | `500` | Safety LIMIT appended when the SQL has no LIMIT clause. |
| `selectionParam` | `string` | — | Param name that receives the selection as an ARRAY of selected rows' `selectionColumn` values. Requires `selectionColumn`; clicking a row toggles it (multi-select). Feedback for the agent — never reference an array param in SQL. |
| `selectionColumn` | `string` | — | Column whose value identifies a selected row (the values written into `selectionParam`). Requires `selectionParam`. |
| `groupBy` | `string \| string[]` | — | Group-by-column mode: one or more result columns to group rows under collapsible synthetic headers (nested when >1). Mutually exclusive with `idColumn`/`parentColumn` (takes priority if both set). |
| `aggregates` | `record<string, "sum" \| "count" \| "avg">` | — | Group-by-column mode only: per-column rollup shown on header rows over each group's descendant leaves. Keys must be result columns; ignored in master-detail mode. |
| `idColumn` | `string` | — | Master-detail (tree) mode: result column holding each row's unique id. Requires `parentColumn`. |
| `parentColumn` | `string` | — | Master-detail (tree) mode: result column referencing a parent row's `idColumn` value. Requires `idColumn`. A null/empty/unmatched parent makes the row a root. |
| `style` | `string` | — | Optional inline CSS declaration string, parsed and merged over the component's defaults (universal prop). |
| `_queryId` | `string` | — | (internal; resolver-stamped, not author-set) |

- **Data-bound:** yes (`sql` → reads the resolved `columns` / `rows`; columns fall back to `Object.keys(rows[0])`).
- **Writes param:** the definition declares `writesParam: false`, but when both `selectionParam` and `selectionColumn` are set the component DOES write to `props.selectionParam` via `useFusedParam`, broadcasting an **array** of the selected rows' `selectionColumn` values.

## Notes
- Renderer chrome is the dumb ui-kit `DataTable` primitive (`@kit`; spec/ui/ui-architecture.md §6.2) — this widget owns view-state (sort key/dir, filters, selection) and feeds it in as values + callbacks. State wrappers (`Card`, `LoadingState`, `ErrorState`, `EmptyState`) come from `../components/card`.
- The `writesParam: false` flag (read by the generator into `components.json`'s `isInput`) does not reflect the conditional selection write; the selection facet is an Fused feedback extension (spec/ui/json-ui.md § Actions & selection) rather than a declared input component.
