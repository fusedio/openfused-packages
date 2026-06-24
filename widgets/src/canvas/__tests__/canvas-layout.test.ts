import { describe, it, expect } from "vitest";

import { autoLayout, classifyLayers } from "../canvas-layout";
import type { CanvasNode } from "../canvas-types";

describe("autoLayout (DTV)", () => {
  const n = (
    id: string,
    type: string,
    extra: Partial<CanvasNode> = {},
  ): CanvasNode => ({ id, widget: { type }, ...extra });
  const xOf = (out: CanvasNode[], id: string) =>
    out.find((m) => m.id === id)!.position!.x;

  it("returns nodes unchanged when every node has a position", () => {
    const a = n("a", "text", { position: { x: 10, y: 20 } });
    const b = n("b", "text", { position: { x: 300, y: 400 } });
    const out = autoLayout([a, b], [{ source: "a", target: "b" }]);
    expect(out.find((m) => m.id === "a")!.position).toEqual({ x: 10, y: 20 });
    expect(out.find((m) => m.id === "b")!.position).toEqual({ x: 300, y: 400 });
  });

  it("lays a pipeline out left→right: data left of transform left of view", () => {
    const nodes = [
      n("a", "sql-runner"),
      n("b", "transformer"),
      n("c", "metric"),
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const out = autoLayout(nodes, edges);
    expect(xOf(out, "a")).toBeLessThan(xOf(out, "b"));
    expect(xOf(out, "b")).toBeLessThan(xOf(out, "c"));
  });

  it("never overlaps two auto-placed nodes", () => {
    const nodes = [
      n("a", "metric"),
      n("b", "metric"),
      n("c", "metric"),
      n("d", "metric"),
    ];
    const edges = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];
    const out = autoLayout(nodes, edges);
    const boxes = out.map((m) => ({
      x: m.position!.x,
      y: m.position!.y,
      w: m.size?.width ?? 220,
      h: m.size?.height ?? 120,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i];
        const B = boxes[j];
        const overlap =
          A.x < B.x + B.w &&
          A.x + A.w > B.x &&
          A.y < B.y + B.h &&
          A.y + A.h > B.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("keeps an authored position and lays out only the position-less nodes", () => {
    const a = n("a", "text", {
      position: { x: 10, y: 20 },
      size: { width: 200, height: 100 },
    });
    const b = n("b", "text");
    const out = autoLayout([a, b], [{ source: "a", target: "b" }]);
    expect(out.find((m) => m.id === "a")!.position).toEqual({ x: 10, y: 20 });
    const pb = out.find((m) => m.id === "b")!.position!;
    expect(Number.isFinite(pb.x) && Number.isFinite(pb.y)).toBe(true);
  });

  it("is deterministic", () => {
    const mk = () => [n("a", "sql-runner"), n("b", "metric")];
    const e = [{ source: "a", target: "b" }];
    expect(autoLayout(mk(), e)).toEqual(autoLayout(mk(), e));
  });

  it("keeps an auto-placed node from overlapping an authored one (mixed canvas)", () => {
    const a = n("a", "text", {
      position: { x: 1000, y: 0 },
      size: { width: 240, height: 140 },
    });
    const b = n("b", "text", { size: { width: 240, height: 140 } });
    const out = autoLayout([a, b], [{ source: "a", target: "b" }]);
    const A = out.find((m) => m.id === "a")!;
    const B = out.find((m) => m.id === "b")!;
    expect(A.position).toEqual({ x: 1000, y: 0 });
    const overlap =
      A.position!.x < B.position!.x + 240 &&
      A.position!.x + 240 > B.position!.x &&
      A.position!.y < B.position!.y + 140 &&
      A.position!.y + 140 > B.position!.y;
    expect(overlap).toBe(false);
  });

  it("wraps a tall rank into multiple sub-columns instead of one strip", () => {
    // Six tall (two-chart) view nodes fed by one source → same view rank.
    const tall = (id: string): CanvasNode => ({
      id,
      widget: {
        type: "div",
        children: [{ type: "bar-chart" }, { type: "bar-chart" }],
      },
    });
    const views = ["v1", "v2", "v3", "v4", "v5", "v6"].map(tall);
    const nodes = [n("src", "sql-runner"), ...views];
    const edges = views.map((v) => ({ source: "src", target: v.id }));
    const out = autoLayout(nodes, edges);

    // The view nodes spread across more than one x (sub-columns), not a single stack.
    const viewXs = new Set(
      views.map((v) => out.find((m) => m.id === v.id)!.position!.x),
    );
    expect(viewXs.size).toBeGreaterThanOrEqual(2);
  });
});

describe("classifyLayers", () => {
  const n = (
    id: string,
    type: string,
    layer?: CanvasNode["layer"],
  ): CanvasNode => ({
    id,
    widget: { type },
    ...(layer ? { layer } : {}),
  });

  it("infers data (source) / transform (middle) / view (sink) from edges", () => {
    const nodes = [
      n("a", "sql-runner"),
      n("b", "transformer"),
      n("c", "metric"),
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const layers = classifyLayers(nodes, edges);
    expect(layers.get("a")).toBe("data");
    expect(layers.get("b")).toBe("transform");
    expect(layers.get("c")).toBe("view");
  });

  it("lets an explicit layer override topology", () => {
    const nodes = [n("a", "sql-runner"), n("b", "metric", "data")];
    const edges = [{ source: "a", target: "b" }]; // topology would say b = view
    expect(classifyLayers(nodes, edges).get("b")).toBe("data");
  });

  it("classifies a disconnected controls-only node as data", () => {
    const ctrl: CanvasNode = {
      id: "ctrl",
      widget: {
        type: "div",
        children: [{ type: "slider" }, { type: "dropdown" }],
      },
    };
    expect(classifyLayers([ctrl], []).get("ctrl")).toBe("data");
  });

  it("classifies a disconnected chart as view", () => {
    expect(classifyLayers([n("c", "bar-chart")], []).get("c")).toBe("view");
  });
});
