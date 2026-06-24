import { describe, it, expect } from "vitest";

import {
  GLOBAL_MIN,
  collectWidgetTypes,
  isFill,
  estimateSize,
  estimateContentHeight,
  clampSize,
} from "../canvas-node-size";
import type { CanvasNode } from "../canvas-types";

const node = (widget: CanvasNode["widget"]): CanvasNode => ({
  id: "n",
  widget,
});

describe("canvas-node-size", () => {
  it("collects every widget type in the subtree", () => {
    const types = collectWidgetTypes({
      type: "div",
      children: [{ type: "slider" }, { type: "bar-chart" }],
    });
    expect(types).toEqual(new Set(["div", "slider", "bar-chart"]));
  });

  it("marks chart/map/iframe nodes as container-filling", () => {
    expect(isFill(node({ type: "bar-chart" }))).toBe(true);
    expect(isFill(node({ type: "fused-map" }))).toBe(true);
    expect(isFill(node({ type: "iframe" }))).toBe(true);
    // a div containing a chart fills:
    expect(
      isFill(node({ type: "div", children: [{ type: "line-chart" }] })),
    ).toBe(true);
  });

  it("does NOT mark text/metric/control nodes as filling", () => {
    expect(isFill(node({ type: "text" }))).toBe(false);
    expect(isFill(node({ type: "metric" }))).toBe(false);
    expect(isFill(node({ type: "div", children: [{ type: "slider" }] }))).toBe(
      false,
    );
  });

  it("estimates a chart larger than a metric", () => {
    const chart = estimateSize(node({ type: "bar-chart" }));
    const metric = estimateSize(node({ type: "metric" }));
    expect(chart.width).toBeGreaterThan(metric.width);
    expect(chart.height).toBeGreaterThan(metric.height);
  });

  it("clamps below the global minimum up to the min", () => {
    const clamped = clampSize(
      { width: 10, height: 10 },
      node({ type: "text" }),
    );
    expect(clamped.width).toBeGreaterThanOrEqual(GLOBAL_MIN.width);
    expect(clamped.height).toBeGreaterThanOrEqual(GLOBAL_MIN.height);
  });

  it("estimates a chart-containing node taller than a plain text node", () => {
    const chart = node({
      type: "div",
      children: [
        { type: "text", props: { variant: "h3" } },
        { type: "bar-chart" },
      ],
    });
    const text = node({ type: "text", props: {} });
    expect(estimateContentHeight(chart)).toBeGreaterThan(
      estimateContentHeight(text),
    );
  });

  it("estimates a two-chart node well above a one-chart node (each chart ~300px)", () => {
    const one = node({ type: "div", children: [{ type: "bar-chart" }] });
    const two = node({
      type: "div",
      children: [{ type: "bar-chart" }, { type: "bar-chart" }],
    });
    expect(estimateContentHeight(two)).toBeGreaterThan(
      estimateContentHeight(one) + 250,
    );
  });

  it("clamps width to the per-type max but lets height grow to a generous ceiling", () => {
    const clamped = clampSize(
      { width: 9999, height: 9999 },
      node({ type: "metric" }),
    );
    // Width is bounded per type (columns must read well)...
    expect(clamped.width).toBeLessThanOrEqual(320);
    // ...but height is free to fit content (charts want ~300px each), capped
    // only by a generous global ceiling — NOT the tight per-type height.
    expect(clamped.height).toBeGreaterThan(200);
    expect(clamped.height).toBeLessThanOrEqual(880);
  });
});
