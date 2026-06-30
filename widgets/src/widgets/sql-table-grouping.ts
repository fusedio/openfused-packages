// sql-table-grouping.ts — pure row-grouping engine for sql-table.
//
// No React, no SDK. Takes flat rows + grouping config + view-state, returns
// GroupedResult: the flattened display-order rows augmented with per-row RowMeta.
//
// Two grouping modes (discriminated union on the config):
//   1. groupBy   — group-header rows synthesised per distinct combo of groupBy columns.
//   2. idColumn  — master-detail (adjacency list) tree; rows supply their own id/parent.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Group-by-column mode: synthetic header rows per distinct value combo. */
export type GroupByConfig = { groupBy: string[] };

/** Adjacency-list (master-detail) mode: rows carry id + parentColumn FK. */
export type MasterDetailConfig = { idColumn: string; parentColumn: string };

/** Discriminated grouping configuration. */
export type GroupingConfig = GroupByConfig | MasterDetailConfig;

export type Aggregate = "sum" | "count" | "avg";

/** Per-row display metadata. */
export interface RowMeta {
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

/** Result from buildGroupedRows. */
export interface GroupedResult {
  rows: Record<string, unknown>[];
  meta: RowMeta[];
  /** Group keys present in the result (useful for expand-all / collapse-all). */
  keys: string[];
}

/** View-state consumed by the engine. */
export interface GroupingViewState {
  collapsedKeys: ReadonlySet<string>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  /** When false, no within-group sort is applied. */
  sortable: boolean;
  aggregates?: Record<string, Aggregate>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isGroupByConfig(cfg: GroupingConfig): cfg is GroupByConfig {
  return "groupBy" in cfg;
}

/** Comparator matching sql-table.tsx:230-242 semantics. */
function compareValues(av: unknown, bv: unknown): number {
  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
    numeric: true,
  });
}

function sortRows(
  rows: Record<string, unknown>[],
  sortKey: string,
  sortDir: "asc" | "desc",
): Record<string, unknown>[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const cmp = compareValues(a[sortKey], b[sortKey]);
    return sortDir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

/** Coerce a cell value to a number for aggregation. Returns NaN if not coercible. */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? NaN : n;
  }
  return NaN;
}

function computeAggregate(
  leaves: Record<string, unknown>[],
  col: string,
  agg: Aggregate,
): unknown {
  if (agg === "count") return leaves.length;
  const nums = leaves.map((r) => toNumber(r[col])).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  if (agg === "sum") return total;
  return total / nums.length; // avg
}

// ---------------------------------------------------------------------------
// Group-by mode
// ---------------------------------------------------------------------------

function buildGroupByRows(
  rows: Record<string, unknown>[],
  cfg: GroupByConfig,
  vs: GroupingViewState,
): GroupedResult {
  const { groupBy } = cfg;
  const { collapsedKeys, sortKey, sortDir, sortable, aggregates } = vs;

  if (groupBy.length === 0) {
    // Degenerate: no group columns → passthrough
    return passthroughResult(rows, vs);
  }

  // Build ordered list of unique group key combos (depth levels = groupBy.length).
  // We process one level at a time, recursively.
  return buildGroupByLevel(rows, groupBy, 0, [], collapsedKeys, sortKey, sortDir, sortable, aggregates ?? {});
}

function buildGroupByLevel(
  rows: Record<string, unknown>[],
  groupBy: string[],
  depth: number,
  parentKeyParts: string[],
  collapsedKeys: ReadonlySet<string>,
  sortKey: string | null,
  sortDir: "asc" | "desc",
  sortable: boolean,
  aggregates: Record<string, Aggregate>,
): GroupedResult {
  const col = groupBy[depth];
  const isLeafLevel = depth === groupBy.length - 1;

  // Collect distinct values in stable insertion order.
  const seenValues: unknown[] = [];
  const buckets = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const val = row[col];
    const valKey = String(val ?? "");
    if (!buckets.has(valKey)) {
      seenValues.push(val);
      buckets.set(valKey, []);
    }
    buckets.get(valKey)!.push(row);
  }

  // Sort sibling group values if sortKey matches the groupBy column.
  let sortedValues = seenValues;
  if (sortable && sortKey === col) {
    sortedValues = [...seenValues].sort((a, b) => {
      const cmp = compareValues(a, b);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const outRows: Record<string, unknown>[] = [];
  const outMeta: RowMeta[] = [];
  const outKeys: string[] = [];

  for (const val of sortedValues) {
    const valKey = String(val ?? "");
    const keyParts = [...parentKeyParts, valKey];
    // Join with the ASCII unit separator (U+001F) so group values containing
    // spaces can't collide across levels (e.g. ["North","West Side"] vs
    // ["North West","Side"]). U+001F never appears in real column data and,
    // unlike NUL, keeps the file textual (git won't mark it binary). A
    // single-element key is still the bare value, so single-level keys are
    // unchanged.
    const groupKey = keyParts.join("");
    const bucket = buckets.get(valKey)!;
    const isExpanded = !collapsedKeys.has(groupKey);

    // Build synthetic header row.
    const headerRow: Record<string, unknown> = {};
    for (const k of groupBy) headerRow[k] = undefined;
    headerRow[col] = val;

    // Compute aggregates on the header.
    const leaves = isLeafLevel ? bucket : collectLeaves(bucket, groupBy, depth + 1);
    for (const [aggCol, aggFn] of Object.entries(aggregates)) {
      if (!groupBy.includes(aggCol)) {
        headerRow[aggCol] = computeAggregate(leaves, aggCol, aggFn);
      }
    }

    outRows.push(headerRow);
    outMeta.push({ depth, expandable: true, expanded: isExpanded });
    outKeys.push(groupKey);

    if (!isExpanded) continue;

    if (isLeafLevel) {
      // Sort leaf rows within group.
      const sorted =
        sortable && sortKey !== null && !groupBy.includes(sortKey)
          ? sortRows(bucket, sortKey, sortDir)
          : bucket;
      for (const row of sorted) {
        outRows.push(row);
        outMeta.push({ depth: depth + 1, expandable: false, expanded: false });
        outKeys.push(""); // leaf has no group key
      }
    } else {
      // Recurse into next level.
      const child = buildGroupByLevel(
        bucket,
        groupBy,
        depth + 1,
        keyParts,
        collapsedKeys,
        sortKey,
        sortDir,
        sortable,
        aggregates,
      );
      for (const r of child.rows) outRows.push(r);
      for (const m of child.meta) outMeta.push(m);
      for (const k of child.keys) outKeys.push(k);
    }
  }

  return { rows: outRows, meta: outMeta, keys: outKeys };
}

/** Collect all leaf rows from buckets at the deepest groupBy level. */
function collectLeaves(
  rows: Record<string, unknown>[],
  groupBy: string[],
  fromDepth: number,
): Record<string, unknown>[] {
  if (fromDepth >= groupBy.length) return rows;
  const col = groupBy[fromDepth];
  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const k = String(row[col] ?? "");
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(row);
  }
  const leaves: Record<string, unknown>[] = [];
  for (const bucket of buckets.values()) {
    leaves.push(...collectLeaves(bucket, groupBy, fromDepth + 1));
  }
  return leaves;
}

// ---------------------------------------------------------------------------
// Master-detail (adjacency list) mode
// ---------------------------------------------------------------------------

function buildMasterDetailRows(
  rows: Record<string, unknown>[],
  cfg: MasterDetailConfig,
  vs: GroupingViewState,
): GroupedResult {
  const { idColumn, parentColumn } = cfg;
  const { collapsedKeys, sortKey, sortDir, sortable } = vs;

  // Index rows by id. Detect roots (null/""/unmatched parent).
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = String(row[idColumn] ?? "");
    if (id !== "") byId.set(id, row);
  }

  // Build children map.
  const children = new Map<string, Record<string, unknown>[]>();
  const roots: Record<string, unknown>[] = [];

  for (const row of rows) {
    const parentId = row[parentColumn];
    const parentStr = parentId === null || parentId === undefined ? "" : String(parentId);
    const id = String(row[idColumn] ?? "");

    // Self-parent or unmatched parent → treat as root.
    if (parentStr === "" || parentStr === id || !byId.has(parentStr)) {
      roots.push(row);
    } else {
      if (!children.has(parentStr)) children.set(parentStr, []);
      children.get(parentStr)!.push(row);
    }
  }

  const outRows: Record<string, unknown>[] = [];
  const outMeta: RowMeta[] = [];
  const outKeys: string[] = [];

  function walk(
    nodes: Record<string, unknown>[],
    depth: number,
    visited: Set<string>,
  ): void {
    const sorted =
      sortable && sortKey !== null ? sortRows(nodes, sortKey, sortDir) : nodes;
    for (const node of sorted) {
      const id = String(node[idColumn] ?? "");
      if (visited.has(id)) continue; // cycle guard
      visited.add(id);

      const kids = children.get(id) ?? [];
      const expandable = kids.length > 0;
      const isExpanded = expandable && !collapsedKeys.has(id);

      outRows.push(node);
      outMeta.push({ depth, expandable, expanded: isExpanded });
      outKeys.push(id);

      if (isExpanded) {
        walk(kids, depth + 1, visited);
      }
    }
  }

  walk(roots, 0, new Set<string>());
  return { rows: outRows, meta: outMeta, keys: outKeys };
}

// ---------------------------------------------------------------------------
// Passthrough (no grouping)
// ---------------------------------------------------------------------------

function passthroughResult(
  rows: Record<string, unknown>[],
  vs: GroupingViewState,
): GroupedResult {
  const { sortKey, sortDir, sortable } = vs;
  const out = sortable && sortKey !== null ? sortRows(rows, sortKey, sortDir) : rows;
  return {
    rows: out,
    meta: out.map(() => ({ depth: 0, expandable: false, expanded: false })),
    keys: out.map(() => ""),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build the display-order row list with grouping, aggregates, collapse, and sort.
 *
 * @param rows      Flat rows from DuckDB (passed through unchanged for leaves).
 * @param config    Grouping mode discriminated union.
 * @param viewState Collapse state, sort, aggregate specs.
 */
export function buildGroupedRows(
  inputRows: ReadonlyArray<Record<string, unknown>>,
  config: GroupingConfig,
  viewState: GroupingViewState,
): GroupedResult {
  if (inputRows.length === 0) {
    return { rows: [], meta: [], keys: [] };
  }

  // Copy to a mutable array once; the engine never mutates leaf rows but its
  // internal helpers operate on mutable Record arrays.
  const rows = [...inputRows];

  if (isGroupByConfig(config)) {
    return buildGroupByRows(rows, config, viewState);
  } else {
    return buildMasterDetailRows(rows, config, viewState);
  }
}
