import { describe, it, expect, vi } from "vitest";

import { parseCanvasConfig } from "../canvas-config";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  widget: { type: "text", props: { text: id } },
  ...extra,
});

describe("parseCanvasConfig", () => {
  it("keeps valid nodes and edges and builds edgeConnectionKeys", () => {
    const r = parseCanvasConfig({
      nodes: [node("a"), node("b")],
      edges: [{ source: "a", target: "b" }],
    });
    expect(r.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]).toMatchObject({
      source: "a",
      target: "b",
      directional: true,
      id: "a->b",
    });
    expect(r.edgeConnectionKeys.has("a->b")).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("drops dangling, self, and duplicate edges with warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseCanvasConfig({
      nodes: [node("a"), node("b")],
      edges: [
        { source: "a", target: "b" },
        { source: "a", target: "b" }, // duplicate
        { source: "b", target: "a" }, // duplicate (reverse pair)
        { source: "a", target: "a" }, // self
        { source: "a", target: "ghost" }, // dangling
      ],
    });
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]).toMatchObject({ source: "a", target: "b" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("flags duplicate node ids and drops duplicate nodes", () => {
    const r = parseCanvasConfig({ nodes: [node("a"), node("a")], edges: [] });
    expect(r.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(r.errors.some((e) => /duplicate/i.test(e))).toBe(true);
  });

  it("defaults edges to [] and tolerates missing props", () => {
    expect(parseCanvasConfig({ nodes: [node("a")] }).edges).toEqual([]);
    expect(parseCanvasConfig(undefined).nodes).toEqual([]);
  });

  it("honours an explicit edge id and directional:false", () => {
    const r = parseCanvasConfig({
      nodes: [node("a"), node("b")],
      edges: [{ id: "custom", source: "a", target: "b", directional: false }],
    });
    expect(r.edges[0]).toMatchObject({ id: "custom", directional: false });
  });
});

describe("parseCanvasConfig — folders", () => {
  it("keeps valid folders and builds the node→folder index", () => {
    const r = parseCanvasConfig({
      nodes: [node("a"), node("b"), node("c")],
      folders: [{ id: "f1", nodeIds: ["a", "b"], title: "Inputs" }],
    });
    expect(r.folders).toHaveLength(1);
    expect(r.folders[0]).toMatchObject({
      id: "f1",
      nodeIds: ["a", "b"],
      collapsed: false,
    });
    expect(r.nodeFolder.get("a")).toBe("f1");
    expect(r.nodeFolder.get("b")).toBe("f1");
    expect(r.nodeFolder.has("c")).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it("errors on a folder id that collides with a node id", () => {
    const r = parseCanvasConfig({
      nodes: [node("a")],
      folders: [{ id: "a", nodeIds: [] }],
    });
    expect(r.errors.join(" ")).toMatch(/folder id "a"/i);
    expect(r.folders).toHaveLength(0);
  });

  it("errors on a duplicate folder id", () => {
    const r = parseCanvasConfig({
      nodes: [node("a"), node("b")],
      folders: [
        { id: "f1", nodeIds: ["a"] },
        { id: "f1", nodeIds: ["b"] },
      ],
    });
    expect(r.errors.join(" ")).toMatch(/duplicate folder id "f1"/i);
    expect(r.folders).toHaveLength(1);
  });

  it("assigns a node in two folders to the first only, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseCanvasConfig({
      nodes: [node("a")],
      folders: [
        { id: "f1", nodeIds: ["a"] },
        { id: "f2", nodeIds: ["a"] },
      ],
    });
    expect(r.nodeFolder.get("a")).toBe("f1");
    expect(r.folders.find((f) => f.id === "f2")!.nodeIds).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops dangling member ids with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseCanvasConfig({
      nodes: [node("a")],
      folders: [{ id: "f1", nodeIds: ["a", "ghost"] }],
    });
    expect(r.folders[0].nodeIds).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("defaults folders to an empty array when absent", () => {
    const r = parseCanvasConfig({ nodes: [node("a")] });
    expect(r.folders).toEqual([]);
    expect(r.nodeFolder.size).toBe(0);
  });

  it("defaults the layout to dtv and honours an explicit dag", () => {
    expect(parseCanvasConfig({ nodes: [node("a")] }).layout).toBe("dtv");
    expect(
      parseCanvasConfig({ nodes: [node("a")], layout: "dag" }).layout,
    ).toBe("dag");
    // Any non-"dag" value falls back to "dtv" (the byte-identical default path).
    expect(
      parseCanvasConfig({
        nodes: [node("a")],
        layout: "bogus" as unknown as "dtv",
      }).layout,
    ).toBe("dtv");
  });
});
