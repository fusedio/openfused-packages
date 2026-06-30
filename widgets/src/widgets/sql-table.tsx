// widgets/sql-table.tsx — DuckDB-SQL-driven table (the app's `sql-table`).
//
// RENAME of openfused's legacy `table` to align with the application's
// `sql-table` component. The declared prop contract is a strict SUBSET of the
// app's `SqlTablePropsSchema`
// (application/client/src/udfrun/json-ui/components/sql-table/index.tsx):
// identical prop NAMES/TYPES/SEMANTICS, fewer props. The app renders with
// AG-Grid; openfused reproduces the same CONFIG semantics with the shared
// ui-kit `DataTable` primitive (a dumb props-in/JSX-out table; see
// spec/ui/ui-architecture.md §6.2) — identical rendering is NOT required,
// identical config behaviour IS. View-state (sort/filter/selection) stays
// local to this widget and is fed into the primitive as values + callbacks.
//
// Authored ONLY against `@fusedio/widget-sdk`: reads `element.props`, declares
// real-zod props `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql, queryId, enabled, maxRows })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// + the `writesParam: false` flag the generator reads.
//
// Prop changes from the legacy openfused `table`:
//   • `query` (required string)  -> `sql` (required string)   universal query→sql
//     rename; same DuckDB-SQL semantics ({{udf_name}} / $param placeholders).
//   • `limit` (openfused-only client slice) REMOVED — the app has no `limit`
//     prop. Replaced by `maxRows`.
//   • `maxRows` ADDED (number, int, positive, app default 500): the app's safety
//     LIMIT appended to the query when it has no LIMIT clause, applied by the SDK
//     hook via `useDuckDbSqlQuery({ maxRows })` — a query-side LIMIT injection,
//     NOT a post-fetch slice.
//   • `sortable` ADDED (boolean, app default true): clickable-header sort on the
//     light HTML table.
//   • `filterable` ADDED (boolean, app default false): per-column header filter
//     inputs (a faithful subset of AG-Grid's column filters).
//   • the universal `css` is read off `element.props.style` (the universal
//     `css → style` rename lands in ./_universal.ts globally; this file must NOT
//     redeclare `style`).
//   • `selectionParam` + `selectionColumn` ADDED (openfused FEEDBACK extension —
//     spec/ui/json-ui.md § Actions & selection, NOT an app prop): when BOTH are
//     set, clicking a row toggles its membership in the selection and the param
//     store receives the ARRAY of selected rows' `selectionColumn` values
//     (multi-select, no modifier keys). Selected rows get a highlighted state.
//     Selections ride in every session feedback payload as ordinary params;
//     array-valued params must NOT be referenced in SQL (json-ui-data.md).
//     With either prop absent the table behaves exactly as before.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope and
// permitted as a strict subset — configs that set them paste without error and
// are simply ignored, never reinterpreted):
//   • the AI-host props (`aiBuilderMode`, `aiPanel`, `showEditor`,
//     `editorPosition`, `editorCollapsed`, `editorHeight`) — they require the
//     @json-render / AiChatHost / CodeMirror surface, which is forbidden here.
//
// Host-state seam is the SDK's `useDuckDbSqlQuery`, whose result is
// `{ rows, columns: string[], loading, error, refetch }` — so columns are plain
// strings and the state machine collapses to no-sql → loading → error → empty →
// ready. Columns are inferred from the result `columns`, falling back to the
// first row's keys (mirrors the app's `buildColumnDefs`, which keys off
// `Object.keys(rows[0])`). In-card states keep one failing query from blanking
// the dashboard (§6).

import React from "react";
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  useFusedParam,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { DataTable } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import {
  buildGroupedRows,
  type GroupingConfig,
  type Aggregate,
} from "./sql-table-grouping";
import type { ComponentDef } from "./types";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";

const DEFAULT_SQL_TABLE_MAX_ROWS = 500;

// ----------------------------------------------------------------- props schema
// A strict subset of the application's SqlTablePropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in
// via `.extend(UNIVERSAL_PROPS.shape)`. The AI-host props are intentionally
// omitted.
export const sqlTableProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Each result column becomes a table column; each row a table row. Example: SELECT * FROM {{my_udf}} LIMIT 100",
      ),
    title: z.string().optional().describe("Table title displayed above."),
    sortable: z
      .boolean()
      .optional()
      .default(true)
      .describe("Allow sorting rows by clicking column headers."),
    filterable: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show filter inputs below column headers."),
    maxRows: z
      .number()
      .int()
      .positive()
      .optional()
      .default(DEFAULT_SQL_TABLE_MAX_ROWS)
      .describe(
        "Safety limit appended when the SQL query has no LIMIT clause. Defaults to 500.",
      ),
    selectionParam: z
      .string()
      .optional()
      .describe(
        "Param name that receives the selection as an ARRAY of the selected rows' selectionColumn values. Requires selectionColumn. Clicking a row toggles it (multi-select). Selections are feedback for the agent — never reference an array param in SQL.",
      ),
    selectionColumn: z
      .string()
      .optional()
      .describe(
        "Column whose value identifies a selected row (the values written into selectionParam). Requires selectionParam.",
      ),
    groupBy: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "GROUP-BY-COLUMN mode: one or more result columns to group rows under collapsible headers (nested when an array of >1 column). Each distinct value combo becomes an expandable synthetic header row; data rows nest beneath. The named column(s) must exist in the SQL result. Mutually exclusive with idColumn/parentColumn.",
      ),
    idColumn: z
      .string()
      .optional()
      .describe(
        "MASTER-DETAIL (tree) mode: the result column holding each row's unique id. Requires parentColumn (both must be set). Rows whose parentColumn is null/empty/unmatched become roots; others nest under their parent. The named columns must exist in the SQL result. Mutually exclusive with groupBy.",
      ),
    parentColumn: z
      .string()
      .optional()
      .describe(
        "MASTER-DETAIL (tree) mode: the result column referencing a parent row's idColumn value. Requires idColumn (both must be set). The named columns must exist in the SQL result.",
      ),
    aggregates: z
      .record(z.string(), z.enum(["sum", "count", "avg"]))
      .optional()
      .describe(
        "GROUP-BY-COLUMN mode only: per-column rollup shown on the synthetic header rows, summed over that group's descendant leaf rows (sum/avg coerce values to numbers; count counts leaves). Keys must be result columns. Ignored in master-detail mode.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type SqlTableProps = z.infer<typeof sqlTableProps>;

// ------------------------------------------------------------------ cell render
// Mirrors the app's `formatCellValue`: null/undefined render as "" (empty
// string), bigint via toString, objects via JSON.stringify.
function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// -------------------------------------------------------------------- component
function SqlTable({ element }: ComponentRenderProps<SqlTableProps>) {
  const {
    sql,
    title,
    sortable,
    filterable,
    maxRows,
    selectionParam,
    selectionColumn,
    groupBy,
    idColumn,
    parentColumn,
    aggregates,
  } = element.props;
  const style = (element.props as { style?: string }).style;
  const queryId = (element.props as { _queryId?: string })._queryId;

  // App defaults: sortable true, filterable false. The SDK hook applies the
  // `maxRows` safety LIMIT the same way the app does (query-side LIMIT
  // injection, not a post-fetch slice).
  const isSortable = sortable ?? true;
  const isFilterable = filterable ?? false;

  const { rows, columns, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
    maxRows: maxRows ?? DEFAULT_SQL_TABLE_MAX_ROWS,
  });

  // Sort + filter are local view state over the SDK rows (the light analogue of
  // AG-Grid's client-side sort/filter). Hooks must run unconditionally, so they
  // live above the state-machine branches.
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  // Collapse view-state for grouping (empty = everything expanded by default).
  // The widget owns this and the engine reads it; toggleGroup flips one key.
  const [collapsedKeys, setCollapsedKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  function toggleGroup(key: string) {
    if (key === "") return; // leaf rows carry no group key
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Row selection (spec/ui/json-ui.md § Actions & selection): active only when
  // BOTH selectionParam and selectionColumn are set. The param store holds the
  // ARRAY of selected rows' selectionColumn values; the hook re-renders the
  // table when the param changes (so highlights track external writes too).
  // `broadcastDefaultValue: false` keeps the param untouched until a click.
  const selectionEnabled =
    typeof selectionParam === "string" &&
    selectionParam !== "" &&
    typeof selectionColumn === "string" &&
    selectionColumn !== "";
  const { value: selectionValue, setValue: setSelectionValue } = useFusedParam<
    unknown[]
  >({
    param: selectionEnabled ? selectionParam : undefined,
    defaultValue: [],
    broadcastDefaultValue: false,
  });
  const selectedValues = React.useMemo<readonly unknown[]>(
    () => (Array.isArray(selectionValue) ? selectionValue : []),
    [selectionValue],
  );
  // Object.is catches NaN; === catches the rest (and -0/+0, which Object.is
  // distinguishes but selection should not).
  const isSelectedValue = (v: unknown) =>
    selectedValues.some((s) => s === v || Object.is(s, v));
  const toggleRowSelection = (row: Record<string, unknown>) => {
    if (!selectionEnabled) return;
    const v = row[selectionColumn as string];
    const next = isSelectedValue(v)
      ? selectedValues.filter((s) => !(s === v || Object.is(s, v)))
      : [...selectedValues, v];
    setSelectionValue(next);
  };

  const cols = React.useMemo(
    () =>
      columns.length > 0
        ? [...columns]
        : rows.length > 0
        ? Object.keys(rows[0])
        : [],
    [columns, rows],
  );

  // Filter and sort are split into two memos so the grouping path can consume
  // the FILTERED rows without the global sort applied — the grouping engine owns
  // within-group sort, and sorting twice (here AND in the engine) would scramble
  // the hierarchy. The ungrouped path keeps the original filter-THEN-sort
  // behavior by composing `viewRows` from `filteredRows` + the global sort.
  const filteredRows = React.useMemo(() => {
    let out = rows as ReadonlyArray<Record<string, unknown>>;

    if (isFilterable) {
      const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
      if (active.length > 0) {
        out = out.filter((row) =>
          active.every(([col, needle]) =>
            renderCell(row[col]).toLowerCase().includes(needle.toLowerCase()),
          ),
        );
      }
    }

    return out;
  }, [rows, isFilterable, filters]);

  const viewRows = React.useMemo(() => {
    let out = filteredRows;

    if (isSortable && sortKey !== null) {
      const sorted = [...out];
      sorted.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        let cmp: number;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else {
          cmp = renderCell(av).localeCompare(renderCell(bv), undefined, {
            numeric: true,
          });
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
      out = sorted;
    }

    return out;
  }, [filteredRows, isSortable, sortKey, sortDir]);

  // Derive the grouping config from props: group-by-column when groupBy is set
  // (string normalized to a one-element array), master-detail when BOTH idColumn
  // and parentColumn are non-empty. groupBy takes precedence if (mis)configured
  // with both. null = ungrouped (flat) rendering.
  const groupConfig = React.useMemo<GroupingConfig | null>(() => {
    const cols =
      typeof groupBy === "string"
        ? groupBy !== ""
          ? [groupBy]
          : []
        : Array.isArray(groupBy)
        ? groupBy.filter((c) => c !== "")
        : [];
    if (cols.length > 0) return { groupBy: cols };
    if (
      typeof idColumn === "string" &&
      idColumn !== "" &&
      typeof parentColumn === "string" &&
      parentColumn !== ""
    ) {
      return { idColumn, parentColumn };
    }
    return null;
  }, [groupBy, idColumn, parentColumn]);

  // When grouping is active, the engine consumes the FILTERED rows (not the
  // globally-sorted viewRows) and owns within-group sort + collapse + aggregates.
  const grouped = React.useMemo(
    () =>
      groupConfig === null
        ? null
        : buildGroupedRows(filteredRows, groupConfig, {
            collapsedKeys,
            sortKey,
            sortDir,
            sortable: isSortable,
            aggregates: aggregates as Record<string, Aggregate> | undefined,
          }),
    [groupConfig, filteredRows, collapsedKeys, sortKey, sortDir, isSortable, aggregates],
  );

  function toggleSort(col: string) {
    if (!isSortable) return;
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  let body: React.ReactNode;
  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="table" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (cols.length === 0 || viewRows.length === 0) {
    body = <EmptyState label="No results" />;
  } else {
    // Chrome (scroll container, sticky header, sortable cells, filter inputs,
    // selectable rows) is the dumb ui-kit `DataTable` primitive; this widget
    // keeps ownership of the view-state and feeds it in as values + callbacks.
    body = (
      <DataTable
        columns={cols}
        rows={grouped ? grouped.rows : viewRows}
        rowMeta={grouped ? grouped.meta : undefined}
        onToggleRow={
          grouped ? (i) => toggleGroup(grouped.keys[i]) : undefined
        }
        renderCell={renderCell}
        sortable={isSortable}
        sortKey={sortKey}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        filterable={isFilterable}
        filters={filters}
        onFilterChange={(col, value) =>
          setFilters((prev) => ({ ...prev, [col]: value }))
        }
        selectable={selectionEnabled}
        isRowSelected={(row) =>
          isSelectedValue(row[selectionColumn as string])
        }
        onRowClick={toggleRowSelection}
      />
    );
  }

  // Optional row-count badge mirrors the app header ("N rows"); not a prop.
  const rowBadge =
    sql && !loading && !error && viewRows.length > 0 ? (
      <span className="ofw-table-count">
        {viewRows.length.toLocaleString()} row
        {viewRows.length !== 1 ? "s" : ""}
      </span>
    ) : undefined;

  return (
    <Card
      title={title}
      className="ofw-card--table"
      style={parseStyle(style)}
    >
      {rowBadge}
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: SqlTable,
    props: sqlTableProps,
    description:
      "Table rendered from a DuckDB SQL query. Set selectionParam + selectionColumn to let the human multi-select rows by clicking: the selected rows' selectionColumn values are written to the param as an ARRAY (feedback for the agent — never reference an array param in SQL).",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
