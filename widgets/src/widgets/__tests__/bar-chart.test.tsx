// bar-chart.test.tsx — logic-level guard for the horizontal-bar axis geometry.
//
// The visual bug under investigation: with `horizontal: true` the chart rendered
// as one solid block and the Y-AXIS showed the numeric VALUE instead of the
// category (`label`) ticks. That is the signature of NOT swapping the axes for
// horizontal mode (value scale left on the category axis; categories never
// rendered).
//
// recharts needs a DOM (ResponsiveContainer/svg) to lay out pixels, and this
// `ui` test env is `environment: "node"` with no jsdom — so a pixel render is
// infeasible. Instead we assert the COMPUTED axis configuration the component
// hands to recharts, which is exactly what governs the symptom:
//   • <BarChart layout> must be "vertical" for horizontal bars,
//   • the CATEGORY axis (carrying dataKey="label", type="category") must be the
//     YAxis, and
//   • the NUMBER axis (type="number") must be the XAxis.
// A regression that swaps these back (the reported bug) fails this test.
//
// React hooks are mocked to identities so the function component can be invoked
// directly and its returned element tree walked (no renderer/DOM needed).

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { XAxis, YAxis, BarChart } from "recharts";

// --- mock the SDK hooks the component calls (return plain, render-free values).
const rowsRef = { rows: [] as Array<Record<string, unknown>> };
vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({ rows: rowsRef.rows, loading: false, error: null }),
  useFusedParam: () => ({ setValue: () => {} }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

// --- mock react's render-time hooks to identities so we can call the component
//     function directly (outside a renderer) and inspect its returned tree.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const useMemo = (fn: () => unknown) => fn();
  const useCallback = (fn: unknown) => fn;
  // Patch BOTH the named exports and the `default`/namespace object, because the
  // component reaches hooks via `React.useCallback` (the default import).
  const patched = { ...actual, useMemo, useCallback };
  return { ...patched, default: patched };
});

// Import AFTER mocks so the component closes over the mocked hooks.
const { default: definition } = await import("../bar-chart");

type El = React.ReactElement;

/** Depth-first collect every element in the returned tree whose `type` matches. */
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

function renderTree(props: Record<string, unknown>): unknown {
  const Component = (definition as { component: React.ComponentType<{ element: unknown }> })
    .component;
  // Call the function component directly (hooks are mocked to identities).
  return (Component as unknown as (p: { element: unknown }) => unknown)({
    element: { type: "bar-chart", props, children: [] },
  });
}

const SAMPLE = [
  { label: "Headline A", value: 5 },
  { label: "Headline B", value: 9 },
  { label: "Headline C", value: 2 },
];

describe("bar-chart axis geometry", () => {
  beforeEach(() => {
    rowsRef.rows = SAMPLE;
  });

  it("horizontal:true puts the category(label) scale on the Y axis and the number scale on the X axis", () => {
    const tree = renderTree({
      sql: "select label, value from t",
      horizontal: true,
      showValues: true,
      barRadius: 4,
      barColor: "#22C55E",
      hoverColor: "#16A34A",
      yAxisFontSize: 12,
    });

    const barCharts = findAll(tree, BarChart);
    expect(barCharts.length).toBe(1);
    // horizontal bars => recharts layout MUST be "vertical".
    expect((barCharts[0].props as { layout?: string }).layout).toBe("vertical");

    const xAxes = findAll(tree, XAxis);
    const yAxes = findAll(tree, YAxis);
    expect(xAxes.length).toBe(1);
    expect(yAxes.length).toBe(1);

    const xProps = xAxes[0].props as { type?: string; dataKey?: string };
    const yProps = yAxes[0].props as { type?: string; dataKey?: string };

    // CATEGORY (label) axis must be Y; NUMBER (value) axis must be X.
    expect(yProps.dataKey).toBe("label");
    expect(yProps.type).toBe("category");
    expect(xProps.type).toBe("number");
    // The value/number axis must NOT be bound to the label category…
    expect(xProps.dataKey).not.toBe("label");
    // …and the category axis must NOT be a number scale (the bug's signature:
    // the value '5' showing up as repeated Y ticks).
    expect(yProps.type).not.toBe("number");
  });

  it("horizontal:false keeps the label scale on the X axis (vertical bars unchanged)", () => {
    const tree = renderTree({
      sql: "select label, value from t",
      horizontal: false,
    });

    const barCharts = findAll(tree, BarChart);
    expect((barCharts[0].props as { layout?: string }).layout).toBe("horizontal");

    const xProps = findAll(tree, XAxis)[0].props as { dataKey?: string };
    const yProps = findAll(tree, YAxis)[0].props as { dataKey?: string };
    expect(xProps.dataKey).toBe("label");
    expect(yProps.dataKey).not.toBe("label");
  });
});
