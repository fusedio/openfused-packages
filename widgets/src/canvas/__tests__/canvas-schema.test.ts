import { describe, it, expect } from "vitest";

import { CanvasPropsSchema } from "../canvas-types";

// vitest resolves real zod (build.mjs only stubs zod for the render bundle), so this
// exercises the actual schema (defaults + enum validation).
describe("CanvasPropsSchema", () => {
  it("defaults the canvas to read-only with every edit capability on", () => {
    const out = CanvasPropsSchema.parse({ nodes: [] });
    expect(out.editable).toBe(false);
    expect(out.allowMoveNodes).toBe(true);
    expect(out.allowResizeNodes).toBe(true);
    expect(out.allowConnectNodes).toBe(true);
    expect(out.allowAddNodes).toBe(true);
    expect(out.allowDeleteNodes).toBe(true);
  });

  it("preserves the existing chrome defaults", () => {
    const out = CanvasPropsSchema.parse({ nodes: [] });
    expect(out.showControls).toBe(true);
    expect(out.background).toBe("dots");
    expect(out.fitViewPadding).toBe(0.1);
  });

  it("defaults nodePeek off and honours an explicit true", () => {
    expect(CanvasPropsSchema.parse({ nodes: [] }).nodePeek).toBe(false);
    expect(CanvasPropsSchema.parse({ nodes: [], nodePeek: true }).nodePeek).toBe(true);
  });

  it("honours explicit edit-control values", () => {
    const out = CanvasPropsSchema.parse({
      nodes: [],
      editable: true,
      allowDeleteNodes: false,
    });
    expect(out.editable).toBe(true);
    expect(out.allowDeleteNodes).toBe(false);
    expect(out.allowMoveNodes).toBe(true); // still defaulted on
  });

  it("rejects an unknown background enum value", () => {
    expect(() =>
      CanvasPropsSchema.parse({ nodes: [], background: "wavy" }),
    ).toThrow();
  });

  it("accepts folders and defaults them to expanded", () => {
    const out = CanvasPropsSchema.parse({
      nodes: [],
      folders: [{ id: "inputs", nodeIds: ["a", "b"], title: "Inputs" }],
    });
    expect(out.folders).toHaveLength(1);
    expect(out.folders![0]).toMatchObject({
      id: "inputs",
      nodeIds: ["a", "b"],
      title: "Inputs",
    });
    // collapsed is optional with no default at the schema level (absent ⇒ expanded at render).
    expect(out.folders![0].collapsed).toBeUndefined();
  });

  it("defaults folders to undefined when omitted", () => {
    const out = CanvasPropsSchema.parse({ nodes: [] });
    expect(out.folders).toBeUndefined();
  });

  it("defaults the layout algorithm to dtv and the band axis to vertical", () => {
    const out = CanvasPropsSchema.parse({ nodes: [] });
    expect(out.layout).toBe("dtv");
    expect(out.folderBands).toBe("vertical");
  });

  it("honours an explicit dag layout", () => {
    const out = CanvasPropsSchema.parse({ nodes: [], layout: "dag" });
    expect(out.layout).toBe("dag");
  });

  it("rejects an unknown layout enum value", () => {
    expect(() =>
      CanvasPropsSchema.parse({ nodes: [], layout: "force" }),
    ).toThrow();
  });
});
