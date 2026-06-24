// metric.test.tsx — logic-level guards for the metric tile.
//
// The visual bug under investigation: all 4 metric tiles rendered the literal
// "…" placeholder instead of the numeric value, even though the aggregate SQL
// resolved fine server-side. Two facets, both asserted here:
//
//   1. VALUE READ (`resolveRawValue`): the aggregate result's single column is
//      named after the SQL expression ("COUNT(*)", "ROUND(AVG(coverage),1)",
//      "COUNT(DISTINCT source)", "age"). The read takes the resolver-provided
//      `columns[0]` (authoritative SQL order) and the first row's cell, coerced
//      to string — so the number is found regardless of the column's name.
//
//   2. LOADING GATE (component render): once a value has resolved, the tile must
//      render that value even while the SDK hook still reports `loading` true.
//      Previously the metric blanked any resolved value back to "…" whenever
//      `loading` was true (e.g. a background re-resolve, or an SDK hook pinned
//      `loading` true by an unresolved `{{ref?p=$param}}` override) — that is the
//      stuck-"…" symptom. The shared metric SKELETON now shows ONLY before a value
//      exists (it replaced the bare "…" placeholder — specs/rendering.md).
//
// recharts/DOM are not needed: React hooks are mocked to identities so the
// function component is invoked directly and its returned element tree walked
// (the bar-chart sibling test uses the same harness).

import { describe, it, expect, vi } from "vitest";
import React from "react";

import { resolveRawValue, formatValue } from "../metric";

// --- SDK hook state the mocked `useDuckDbSqlQuery` reflects into the component.
const sqlState = {
  rows: [] as Array<Record<string, unknown>>,
  columns: [] as string[],
  loading: false,
};

vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({
    rows: sqlState.rows,
    columns: sqlState.columns,
    loading: sqlState.loading,
    error: null,
  }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const useMemo = (fn: () => unknown) => fn();
  const useCallback = (fn: unknown) => fn;
  const patched = { ...actual, useMemo, useCallback };
  return { ...patched, default: patched };
});

// Import AFTER the mocks so the component closes over the mocked hooks.
const { default: definition } = await import("../metric");

function renderTree(props: Record<string, unknown>): unknown {
  const Component = (
    definition as { component: React.ComponentType<{ element: unknown }> }
  ).component;
  return (Component as unknown as (p: { element: unknown }) => unknown)({
    element: { type: "metric", props, children: [] },
  });
}

/** Collect every string/number leaf in the rendered tree, in order. */
function collectText(node: unknown, acc: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return acc;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, acc);
    return acc;
  }
  if (typeof node === "object" && "props" in (node as object)) {
    collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  }
  return acc;
}

/** Concatenated rendered text (drops empty prefix/suffix slots). */
function renderedText(props: Record<string, unknown>): string {
  return collectText(renderTree(props)).join("");
}

const ELLIPSIS = "…";

describe("metric resolveRawValue (value read)", () => {
  it("reads the single aggregate cell regardless of the column's expression name", () => {
    // COUNT(*) → 30, ROUND(AVG(coverage),1) → 4.7, COUNT(DISTINCT source) → 12.
    expect(
      resolveRawValue("sql", [{ "COUNT(*)": 30 }], ["COUNT(*)"], ""),
    ).toBe("30");
    expect(
      resolveRawValue(
        "sql",
        [{ "ROUND(AVG(coverage),1)": 4.7 }],
        ["ROUND(AVG(coverage),1)"],
        "",
      ),
    ).toBe("4.7");
    expect(
      resolveRawValue(
        "sql",
        [{ "COUNT(DISTINCT source)": 12 }],
        ["COUNT(DISTINCT source)"],
        "",
      ),
    ).toBe("12");
    expect(resolveRawValue("sql", [{ age: "2h" }], ["age"], "")).toBe("2h");
  });

  it("uses columns[0] as the authoritative first column (not object key order)", () => {
    // An integer-like key ("0") sorts ahead of a named key under Object.keys,
    // so Object.keys(row)[0] would wrongly pick "0". columns[0] fixes the order.
    const row = { "0": 999, "COUNT(*)": 30 };
    expect(resolveRawValue("sql", [row], ["COUNT(*)", "0"], "")).toBe("30");
  });

  it("falls back to Object.keys when columns are absent", () => {
    expect(resolveRawValue("sql", [{ "COUNT(*)": 30 }], [], "")).toBe("30");
  });

  it("empty/null first cell → '' (app convention)", () => {
    expect(resolveRawValue("sql", [{ "COUNT(*)": null }], ["COUNT(*)"], "")).toBe("");
  });

  it("falls back to the static value when there are no rows", () => {
    expect(resolveRawValue("sql", [], ["COUNT(*)"], "42")).toBe("42");
    expect(resolveRawValue(undefined, [], [], "hi")).toBe("hi");
  });
});

describe("metric formatValue", () => {
  it("format 'none' returns the raw value verbatim (honoring decimals = no rounding)", () => {
    expect(formatValue("30", "none", 1)).toBe("30");
    expect(formatValue("4.7", "none", 1)).toBe("4.7");
    expect(formatValue("2h", "none", 1)).toBe("2h");
  });

  it("format 'comma'/'compact' format numerically", () => {
    expect(formatValue("1234567", "comma", 1)).toBe("1,234,567");
    expect(formatValue("1500", "compact", 1)).toBe("1.5K");
  });
});

describe("metric render (loading gate)", () => {
  it("renders the resolved aggregate number, not the '…' placeholder", () => {
    sqlState.rows = [{ "COUNT(*)": 30 }];
    sqlState.columns = ["COUNT(*)"];
    sqlState.loading = false;
    expect(
      renderedText({ label: "Headlines", sql: "SELECT COUNT(*) FROM {{x}}", format: "none" }),
    ).toBe("30Headlines");
  });

  it("keeps showing a resolved value even while the hook still reports loading", () => {
    // The stuck-"…" symptom: rows ARE present but `loading` stays true (e.g. an
    // unresolved `{{ref?p=$param}}` override pins the SDK hook in loading). The
    // tile must still paint the number — never blank a resolved value to "…".
    sqlState.rows = [{ "COUNT(*)": 30 }];
    sqlState.columns = ["COUNT(*)"];
    sqlState.loading = true;
    const text = renderedText({
      label: "Headlines",
      sql: "SELECT COUNT(*) FROM {{latest_news?topic=$topic&limit=30}}",
      format: "none",
    });
    expect(text).toBe("30Headlines");
    expect(text).not.toContain(ELLIPSIS);
  });

  it("shows the metric skeleton (no value text) before any value has resolved", () => {
    sqlState.rows = [];
    sqlState.columns = [];
    sqlState.loading = true;
    const text = renderedText({
      label: "Headlines",
      sql: "SELECT COUNT(*) FROM {{x}}",
      format: "none",
    });
    // The shared skeleton has no text leaves: no number, no label, and no "…".
    expect(text).toBe("");
    expect(text).not.toContain(ELLIPSIS);
  });
});
