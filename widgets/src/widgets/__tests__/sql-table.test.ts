// sql-table.test.ts — wiring guard for native row grouping in the sql-table
// widget. The widget owns collapse view-state and feeds the grouping engine's
// output into the DataTable primitive as rows + rowMeta + onToggleRow.
//
// Like bar-chart.test.tsx this `ui` env is `environment: "node"` (no jsdom), so
// we mock the SDK hooks + React render hooks to identities, invoke SqlTable
// directly, and walk the returned tree to the DataTable element to inspect the
// props it was handed.
//
// Unlike bar-chart, this file MUST mock React.useState because the collapse
// behavior is driven by it. We route the Set-typed state (collapsedKeys)
// through a module-level mutable ref so a test can preset a collapsed group,
// and capture its setter so we can assert toggle wiring. Other useState calls
// (sortKey/sortDir/filters) get a normal passthrough.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { DataTable } from "@kit";

// --- mock SDK hooks (render-free plain values). rowsRef/columnsRef are mutated
//     per test before invoking the component (mirrors bar-chart's rowsRef).
const rowsRef = { rows: [] as Array<Record<string, unknown>> };
const columnsRef = { columns: [] as string[] };
vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({
    rows: rowsRef.rows,
    columns: columnsRef.columns,
    loading: false,
    error: null,
  }),
  useFusedParam: () => ({ value: [], setValue: () => {} }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

// --- collapse state injection. `collapsedRef.value` is the Set the component
//     sees for its collapsedKeys state; `collapsedRef.setter` captures the
//     useState setter so the toggle test can assert it fired.
const collapsedRef = {
  value: new Set<string>(),
  setter: vi.fn() as ReturnType<typeof vi.fn>,
};

// --- mock react: useMemo/useCallback identities, and a useState that returns a
//     real tuple. The collapsedKeys state is detected by its initializer
//     producing a Set (the widget uses `useState<Set<string>>(() => new Set())`)
//     and is routed through collapsedRef.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const useMemo = (fn: () => unknown) => fn();
  const useCallback = (fn: unknown) => fn;
  const useState = (init: unknown) => {
    const initial = typeof init === "function" ? (init as () => unknown)() : init;
    if (initial instanceof Set) {
      return [collapsedRef.value, collapsedRef.setter];
    }
    // Non-Set states (sortKey/sortDir/filters): return the initial value and a
    // no-op setter — these tests don't drive sort/filter through the setter.
    return [initial, () => {}];
  };
  const patched = { ...actual, useMemo, useCallback, useState };
  return { ...patched, default: patched };
});

// Import AFTER mocks.
const { default: definition } = await import("../sql-table");

type El = React.ReactElement;

function findAll(node: unknown, target: unknown, acc: El[] = []): El[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, target, acc);
    return acc;
  }
  if (typeof node === "object" && node !== null && "type" in node) {
    const el = node as El;
    if (el.type === target) acc.push(el);
    const kids = (el.props as { children?: unknown })?.children;
    if (kids !== undefined) findAll(kids, target, acc);
  }
  return acc;
}

interface DataTableLikeProps {
  rows: ReadonlyArray<Record<string, unknown>>;
  rowMeta?: ReadonlyArray<{ depth: number; expandable: boolean; expanded: boolean }>;
  onToggleRow?: (index: number) => void;
  columns: readonly string[];
}

function renderDataTable(props: Record<string, unknown>): DataTableLikeProps {
  const Component = (definition as { component: React.ComponentType<{ element: unknown }> })
    .component;
  const tree = (Component as unknown as (p: { element: unknown }) => unknown)({
    element: { type: "sql-table", props, children: [] },
  });
  const tables = findAll(tree, DataTable);
  expect(tables.length).toBe(1);
  return tables[0].props as unknown as DataTableLikeProps;
}

const MODELS = [
  { model: "gpt", name: "a", cost: 10 },
  { model: "gpt", name: "b", cost: 20 },
  { model: "claude", name: "c", cost: 30 },
];

describe("sql-table grouping wiring", () => {
  beforeEach(() => {
    rowsRef.rows = MODELS;
    columnsRef.columns = ["model", "name", "cost"];
    collapsedRef.value = new Set<string>();
    collapsedRef.setter = vi.fn();
  });

  it("group-by-column: synthesizes header rows; headers depth0 expandable, leaves depth1", () => {
    const dt = renderDataTable({ sql: "select * from t", groupBy: "model" });
    // 2 headers (gpt, claude) + 3 leaves
    expect(dt.rows.length).toBe(5);
    expect(dt.rowMeta).toBeDefined();
    const meta = dt.rowMeta!;
    // first row is a header
    expect(meta[0]).toEqual({ depth: 0, expandable: true, expanded: true });
    // its children are depth-1 leaves
    expect(meta[1].depth).toBe(1);
    expect(meta[1].expandable).toBe(false);
    // header carries the group column value
    expect(dt.rows[0]["model"]).toBe("gpt");
  });

  it("group-by accepts an array form", () => {
    const dt = renderDataTable({ sql: "select * from t", groupBy: ["model"] });
    expect(dt.rowMeta![0].expandable).toBe(true);
  });

  it("collapse: a preset collapsed key omits that group's children and marks it expanded:false", () => {
    collapsedRef.value = new Set<string>(["gpt"]);
    const dt = renderDataTable({ sql: "select * from t", groupBy: "model" });
    // gpt header + claude header + claude's 1 leaf = 3 rows; gpt's 2 leaves gone
    expect(dt.rows.length).toBe(3);
    const gptHeaderIdx = dt.rows.findIndex(
      (r, i) => r["model"] === "gpt" && dt.rowMeta![i].expandable,
    );
    expect(dt.rowMeta![gptHeaderIdx].expanded).toBe(false);
    // none of gpt's leaves present
    const leafNames = dt.rows.map((r) => r["name"]);
    expect(leafNames).not.toContain("a");
    expect(leafNames).not.toContain("b");
  });

  it("toggle wiring: onToggleRow is a fn and calling it invokes the collapse setter", () => {
    const dt = renderDataTable({ sql: "select * from t", groupBy: "model" });
    expect(typeof dt.onToggleRow).toBe("function");
    dt.onToggleRow!(0); // toggle the first header's group key
    expect(collapsedRef.setter).toHaveBeenCalledTimes(1);
    // Verify the index→key→Set mapping, not just that the setter fired: the
    // functional updater must add grouped.keys[0] ("gpt", the first header's
    // group value — single-level groupBy keys are just the group value).
    const updater = collapsedRef.setter.mock.calls[0][0] as (
      prev: Set<string>,
    ) => Set<string>;
    expect(updater(new Set<string>())).toEqual(new Set(["gpt"]));
  });

  it("master-detail: nested rowMeta depths from adjacency data", () => {
    rowsRef.rows = [
      { id: "1", parent: null, name: "root" },
      { id: "2", parent: "1", name: "child" },
      { id: "3", parent: "2", name: "grandchild" },
    ];
    columnsRef.columns = ["id", "parent", "name"];
    const dt = renderDataTable({
      sql: "select * from t",
      idColumn: "id",
      parentColumn: "parent",
    });
    expect(dt.rowMeta!.map((m) => m.depth)).toEqual([0, 1, 2]);
    expect(dt.rowMeta![0].expandable).toBe(true);
    expect(dt.rowMeta![2].expandable).toBe(false);
  });

  it("ungrouped guard: no grouping props => flat rows, rowMeta/onToggleRow undefined", () => {
    const dt = renderDataTable({ sql: "select * from t" });
    expect(dt.rows.length).toBe(3); // flat passthrough
    expect(dt.rowMeta).toBeUndefined();
    expect(dt.onToggleRow).toBeUndefined();
  });
});
