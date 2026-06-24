// chart-render.browser.test.tsx — the "real tier" guard for chart widgets, run
// in a real (headless) Chromium via Playwright (vitest.browser.config.ts).
//
// This is the LAYOUT/geometry counterpart to the cheap, jsdom-free node tests
// (bar-chart.test.tsx walks the element tree; it can prove the axis CONFIG but
// never that pixels paint). PR #123 had two regressions; this file guards the
// one a node test structurally cannot reach:
//
//   • Bug B — height collapse. recharts' ResponsiveContainer needs a DEFINITE
//     parent height to measure. The pre-#123 CSS gave `.ofw-card--chart
//     .ofw-card__body` only a `min-height` floor (not definite) and `.ofw-chart`
//     a percentage `height: 100%`, so in a CONTENT-SIZED card (the app's
//     single-widget page, where no ancestor pins a height) the percentage-height
//     chain resolved to 0 and the chart drew nothing. This cannot be caught in
//     jsdom — there is no layout engine, getBoundingClientRect is always 0, and
//     the very condition that broke does not exist. So we mount each chart in a
//     content-sized container with the REAL widget.css and assert the rendered
//     surface actually has a non-zero height.
//
//   • Bug A — missing axes (free bonus). recharts 2.x relied on defaultProps,
//     which React 19 silently ignores, so XAxis/YAxis never rendered. In a real
//     browser the axis tick text either paints or it doesn't, so we also assert
//     the category/value ticks are in the DOM — the class of breakage most
//     likely to silently recur on the next recharts/React bump.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";

// The real widget stylesheet under test — Vite injects it into the browser page,
// so the `.ofw-card--chart` height contract is exercised exactly as shipped.
import "../../widget.css";

// --- mock the SDK hooks the chart components call. Unlike the node tests we do
//     NOT mock react: this is a genuine render, so the real hooks must run. We
//     only stub the data seam so rows arrive synchronously (no DuckDB).
const sqlState = { rows: [] as Array<Record<string, unknown>> };
vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({
    rows: sqlState.rows,
    columns: sqlState.rows.length ? Object.keys(sqlState.rows[0]) : [],
    loading: false,
    error: null,
  }),
  useFusedParam: () => ({ setValue: () => {}, value: undefined }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

// Import AFTER the mock so the components close over the stubbed SDK.
const { default: barChart } = await import("../bar-chart");
const { default: lineChart } = await import("../line-chart");
const { default: scatterChart } = await import("../scatter-chart");
const { default: donutChart } = await import("../donut-chart");

type Def = { component: React.ComponentType<{ element: unknown }> };

const LABEL_VALUE = [
  { label: "Alpha", value: 5 },
  { label: "Bravo", value: 9 },
  { label: "Charlie", value: 2 },
];
const XY = [
  { x: 1, y: 2 },
  { x: 3, y: 5 },
  { x: 6, y: 1 },
];

let host: HTMLElement;
let root: Root | null = null;

/** Yield long enough for recharts' rAF-debounced ResizeObserver work to settle. */
async function settle(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  // A CONTENT-SIZED host: it imposes NO height, mirroring the app's single-widget
  // page where no ancestor pins a height. This is the exact condition that made
  // the pre-#123 percentage-height chain collapse to 0; a fixed-height host would
  // have masked the bug.
  document.body.innerHTML = "";
  host = document.createElement("div");
  host.style.width = "640px"; // a definite WIDTH (recharts also needs width to draw)
  document.body.appendChild(host);
});

afterEach(async () => {
  // Unmount AND drain recharts' pending async measurement before the next test
  // mounts — a leftover rAF/ResizeObserver callback re-rendering an unmounted
  // chart corrupts React's hook dispatcher for the next test's render.
  root?.unmount();
  root = null;
  await settle();
  host.remove();
});

/** Mount a chart definition inside the shared `.ofw-card--chart` chrome. */
function mount(def: Def, props: Record<string, unknown>): void {
  const Component = def.component;
  root = createRoot(host);
  root.render(
    React.createElement(Component, {
      element: { type: "chart", props, children: [] },
    }),
  );
}

/**
 * Poll until `cond()` is truthy or the deadline passes. recharts'
 * ResponsiveContainer measures via ResizeObserver one frame after mount, so the
 * surface size is not available synchronously.
 */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = performance.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (cond()) return;
    if (performance.now() - start > timeoutMs)
      throw new Error("waitFor: condition not met before timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** The recharts SVG surface, if it has been laid out with a real height. */
function chartSurface(): SVGSVGElement | null {
  return host.querySelector<SVGSVGElement>("svg.recharts-surface");
}

describe("chart widgets render with a real height (PR #123 Bug B — height collapse)", () => {
  beforeEach(() => {
    sqlState.rows = LABEL_VALUE;
  });

  it("bar-chart: the .ofw-chart body and recharts surface both have non-zero height", async () => {
    mount(barChart as Def, { sql: "select label, value from t", animationMs: 0 });

    await waitFor(() => {
      const svg = chartSurface();
      return !!svg && svg.getBoundingClientRect().height > 0;
    });

    // The flex child that must fill the (definite-height) card body.
    const chart = host.querySelector<HTMLElement>(".ofw-chart");
    expect(chart, ".ofw-chart should be present").not.toBeNull();
    // The exact regression: a content-sized card collapsed this to 0px.
    expect(chart!.getBoundingClientRect().height).toBeGreaterThan(100);

    const svg = chartSurface()!;
    expect(svg.getBoundingClientRect().height).toBeGreaterThan(100);
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(100);
  });

  it("line-chart renders a non-zero surface in a content-sized card", async () => {
    mount(lineChart as Def, { sql: "select label, value from t" });
    await waitFor(() => {
      const svg = chartSurface();
      return !!svg && svg.getBoundingClientRect().height > 0;
    });
    expect(chartSurface()!.getBoundingClientRect().height).toBeGreaterThan(100);
  });

  it("scatter-chart renders a non-zero surface in a content-sized card", async () => {
    sqlState.rows = XY;
    mount(scatterChart as Def, { sql: "select x, y from t" });
    await waitFor(() => {
      const svg = chartSurface();
      return !!svg && svg.getBoundingClientRect().height > 0;
    });
    expect(chartSurface()!.getBoundingClientRect().height).toBeGreaterThan(100);
  });

  it("donut-chart renders a non-zero surface in a content-sized card", async () => {
    mount(donutChart as Def, { sql: "select label, value from t" });
    await waitFor(() => {
      const svg = chartSurface();
      return !!svg && svg.getBoundingClientRect().height > 0;
    });
    expect(chartSurface()!.getBoundingClientRect().height).toBeGreaterThan(100);
  });
});

describe("chart axes paint (PR #123 Bug A — recharts × React 19 defaultProps)", () => {
  beforeEach(() => {
    sqlState.rows = LABEL_VALUE;
  });

  it("bar-chart paints the category (x) tick labels and numeric (y) ticks", async () => {
    mount(barChart as Def, { sql: "select label, value from t", animationMs: 0 });

    // Wait for the cartesian axes to render their tick text. Pre-#123 (recharts
    // 2.x on React 19) the axes never rendered, so this text never appeared.
    await waitFor(() => {
      const ticks = host.querySelectorAll(".recharts-cartesian-axis-tick-value");
      return ticks.length > 0;
    });

    const tickText = Array.from(
      host.querySelectorAll(".recharts-cartesian-axis-tick-value"),
    )
      .map((n) => n.textContent ?? "")
      .join(" ");

    // The category labels (x-axis) must be present…
    expect(tickText).toContain("Alpha");
    expect(tickText).toContain("Bravo");
    expect(tickText).toContain("Charlie");
    // …and there must be more than one axis (both x and y rendered ticks).
    const axes = host.querySelectorAll(".recharts-cartesian-axis");
    expect(axes.length).toBeGreaterThanOrEqual(2);
  });

  it("line-chart paints its category x-axis ticks", async () => {
    mount(lineChart as Def, { sql: "select label, value from t" });
    await waitFor(
      () => host.querySelectorAll(".recharts-cartesian-axis-tick-value").length > 0,
    );
    const tickText = Array.from(
      host.querySelectorAll(".recharts-cartesian-axis-tick-value"),
    )
      .map((n) => n.textContent ?? "")
      .join(" ");
    expect(tickText).toContain("Alpha");
  });
});
