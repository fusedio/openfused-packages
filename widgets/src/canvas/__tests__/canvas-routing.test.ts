import { describe, it, expect } from "vitest";

import type { ParsedEdge } from "../canvas-config";
import { createRouting } from "../canvas-routing";
import type { CanvasNode } from "../canvas-types";

const node = (id: string): CanvasNode => ({
  id,
  widget: { type: "text", props: { text: id } },
});

const edge = (
  source: string,
  target: string,
  directional = true,
): ParsedEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  directional,
});

describe("createRouting", () => {
  it("directional edge a->b: b sees a and b, a does not see b", () => {
    const r = createRouting([node("a"), node("b")], [edge("a", "b")]);
    expect(r.allowedSources("b")).toEqual(expect.arrayContaining(["a", "b"]));
    expect(r.allowedSources("a")).not.toContain("b");
    expect(r.allowedSources("a")).toContain("a");
  });

  it("bidirectional edge a<->b (directional:false): each sees the other", () => {
    const r = createRouting([node("a"), node("b")], [edge("a", "b", false)]);
    expect(r.allowedSources("a")).toEqual(expect.arrayContaining(["a", "b"]));
    expect(r.allowedSources("b")).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("unconnected node c: allowedSources is exactly [c]", () => {
    const r = createRouting(
      [node("a"), node("b"), node("c")],
      [edge("a", "b")],
    );
    expect(r.allowedSources("c")).toEqual(["c"]);
  });

  it("edges a->c and b->c: c sees a, b, and c", () => {
    const r = createRouting(
      [node("a"), node("b"), node("c")],
      [edge("a", "c"), edge("b", "c")],
    );
    expect(r.allowedSources("c")).toEqual(
      expect.arrayContaining(["a", "b", "c"]),
    );
  });

  it("memoizes results per node id (returns a cached array reference)", () => {
    const r = createRouting([node("a"), node("b")], [edge("a", "b")]);
    expect(r.allowedSources("b")).toBe(r.allowedSources("b"));
  });
});
