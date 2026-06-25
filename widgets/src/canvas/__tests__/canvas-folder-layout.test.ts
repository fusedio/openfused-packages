import { describe, it, expect } from "vitest";

import type { ParsedFolder } from "../canvas-config";
import { FOLDER_BAND_GAP, layoutWithFolders } from "../canvas-folder-layout";
import type { CanvasNode } from "../canvas-types";

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  widget: { type: "text", props: { text: id } },
  ...extra,
});
const folder = (
  id: string,
  nodeIds: string[],
  extra: Partial<ParsedFolder> = {},
): ParsedFolder => ({
  id,
  nodeIds,
  collapsed: false,
  ...extra,
});
const fixedSize = () => ({ width: 200, height: 100 });

function inside(
  box: { x: number; y: number; width: number; height: number },
  n: CanvasNode,
) {
  const { x, y } = n.position!;
  const s = fixedSize();
  return (
    x >= box.x &&
    y >= box.y &&
    x + s.width <= box.x + box.width &&
    y + s.height <= box.y + box.height
  );
}

describe("layoutWithFolders", () => {
  it("places position-less members inside their folder's derived box", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const { nodes: out, folderBoxes } = layoutWithFolders(
      nodes,
      [],
      [folder("f1", ["a", "b"])],
      new Map([
        ["a", "f1"],
        ["b", "f1"],
      ]),
      fixedSize,
    );
    const box = folderBoxes.find((f) => f.id === "f1")!;
    const a = out.find((n) => n.id === "a")!;
    const b = out.find((n) => n.id === "b")!;
    expect(inside(box, a)).toBe(true);
    expect(inside(box, b)).toBe(true);
    // The non-member keeps its own auto position and is NOT inside f1.
    const c = out.find((n) => n.id === "c")!;
    expect(c.position).toBeDefined();
    expect(inside(box, c)).toBe(false);
  });

  it("honors an authored folder position/size instead of deriving", () => {
    const { folderBoxes } = layoutWithFolders(
      [node("a")],
      [],
      [
        folder("f1", ["a"], {
          position: { x: 500, y: 600 },
          size: { width: 400, height: 300 },
        }),
      ],
      new Map([["a", "f1"]]),
      fixedSize,
    );
    const box = folderBoxes[0];
    expect(box).toMatchObject({ x: 500, y: 600, width: 400, height: 300 });
  });

  it("grows a too-small authored folder size to contain its members", () => {
    const { nodes: out, folderBoxes } = layoutWithFolders(
      [node("a")],
      [],
      [
        folder("f1", ["a"], {
          position: { x: 500, y: 600 },
          size: { width: 100, height: 100 },
        }),
      ],
      new Map([["a", "f1"]]),
      fixedSize,
    );
    const box = folderBoxes[0];
    const member = out.find((n) => n.id === "a")!;
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
    expect(inside(box, member)).toBe(true);
  });

  it("honors partial authored folder geometry", () => {
    const { nodes: positionedNodes, folderBoxes: positionedBoxes } =
      layoutWithFolders(
        [node("a")],
        [],
        [folder("f1", ["a"], { position: { x: 500, y: 600 } })],
        new Map([["a", "f1"]]),
        fixedSize,
      );
    const positionedBox = positionedBoxes[0];
    const positionedNode = positionedNodes.find((n) => n.id === "a")!;
    expect(positionedBox).toMatchObject({ x: 500, y: 600 });
    expect(inside(positionedBox, positionedNode)).toBe(true);

    const { folderBoxes: sizedBoxes } = layoutWithFolders(
      [node("a")],
      [],
      [folder("f1", ["a"], { size: { width: 700, height: 500 } })],
      new Map([["a", "f1"]]),
      fixedSize,
    );
    expect(sizedBoxes[0]).toMatchObject({ width: 700, height: 500 });
  });

  it("renders a collapsed folder as a short summary bar and contributes no tall band", () => {
    const { folderBoxes } = layoutWithFolders(
      [node("a"), node("b")],
      [],
      [folder("f1", ["a", "b"], { collapsed: true })],
      new Map([
        ["a", "f1"],
        ["b", "f1"],
      ]),
      fixedSize,
    );
    const box = folderBoxes[0];
    expect(box.collapsed).toBe(true);
    expect(box.height).toBeLessThan(100); // summary bar, not the members' stacked height
  });

  it("renders an expanded empty folder as a region rather than a summary bar", () => {
    const { folderBoxes } = layoutWithFolders(
      [],
      [],
      [folder("f1", [])],
      new Map(),
      fixedSize,
    );
    const box = folderBoxes[0];
    expect(box.collapsed).toBe(false);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(48);
  });

  it("derives a box that contains an authored-position member", () => {
    const { folderBoxes } = layoutWithFolders(
      [node("a", { position: { x: 1000, y: 1000 } })],
      [],
      [folder("f1", ["a"])],
      new Map([["a", "f1"]]),
      fixedSize,
    );
    const box = folderBoxes[0];
    expect(box.x).toBeLessThanOrEqual(1000);
    expect(box.y).toBeLessThanOrEqual(1000);
    expect(box.x + box.width).toBeGreaterThanOrEqual(1200);
  });

  it("places later bands below in-place derived folders", () => {
    const { nodes: out, folderBoxes } = layoutWithFolders(
      [node("a", { position: { x: 10, y: 10 } }), node("b"), node("loose")],
      [],
      [folder("f1", ["a"]), folder("f2", ["b"])],
      new Map([
        ["a", "f1"],
        ["b", "f2"],
      ]),
      fixedSize,
    );
    const inPlaceBox = folderBoxes.find((f) => f.id === "f1")!;
    const laterBox = folderBoxes.find((f) => f.id === "f2")!;
    const loose = out.find((n) => n.id === "loose")!;
    expect(laterBox.y).toBeGreaterThanOrEqual(inPlaceBox.y + inPlaceBox.height);
    expect(loose.position!.y).toBeGreaterThanOrEqual(
      laterBox.y + laterBox.height,
    );
  });

  it("places folder-less nodes in a band below the folders", () => {
    const { nodes: out, folderBoxes } = layoutWithFolders(
      [node("a"), node("loose")],
      [],
      [folder("f1", ["a"])],
      new Map([["a", "f1"]]),
      fixedSize,
    );
    const box = folderBoxes.find((f) => f.id === "f1")!;
    const loose = out.find((n) => n.id === "loose")!;
    expect(loose.position).toBeDefined();
    // The ungrouped node sits below the folder band (its top is past the folder box bottom).
    expect(loose.position!.y).toBeGreaterThanOrEqual(box.y + box.height);
  });

  it("lays derived folder bands left→right when bandAxis is horizontal", () => {
    // The pipeline's case: position-less folders + position-less members. Each
    // folder's box should flow left→right, share a top edge, and never overlap.
    const nodes = [node("a"), node("b"), node("c")];
    const { nodes: out, folderBoxes } = layoutWithFolders(
      nodes,
      [],
      [folder("f1", ["a"]), folder("f2", ["b"]), folder("f3", ["c"])],
      new Map([
        ["a", "f1"],
        ["b", "f2"],
        ["c", "f3"],
      ]),
      fixedSize,
      "horizontal",
    );
    const b1 = folderBoxes.find((f) => f.id === "f1")!;
    const b2 = folderBoxes.find((f) => f.id === "f2")!;
    const b3 = folderBoxes.find((f) => f.id === "f3")!;

    // Strictly increasing x (left→right), non-overlapping, with a gap ≥ the band gap.
    expect(b2.x).toBeGreaterThan(b1.x);
    expect(b3.x).toBeGreaterThan(b2.x);
    expect(b2.x).toBeGreaterThanOrEqual(b1.x + b1.width + FOLDER_BAND_GAP);
    expect(b3.x).toBeGreaterThanOrEqual(b2.x + b2.width + FOLDER_BAND_GAP);

    // Shared top edge (cross axis at the origin).
    expect(b1.y).toBe(b2.y);
    expect(b2.y).toBe(b3.y);

    // Each member sits inside its own band's box.
    expect(inside(b1, out.find((n) => n.id === "a")!)).toBe(true);
    expect(inside(b2, out.find((n) => n.id === "b")!)).toBe(true);
    expect(inside(b3, out.find((n) => n.id === "c")!)).toBe(true);
  });

  it("keeps ungrouped nodes in global columns when fed by folder members", () => {
    const { nodes: out } = layoutWithFolders(
      [
        node("folder-source"),
        node("loose-source", { widget: { type: "sql-runner" } }),
        node("loose-output"),
      ],
      [{ source: "folder-source", target: "loose-output" }],
      [folder("f1", ["folder-source"])],
      new Map([["folder-source", "f1"]]),
      fixedSize,
    );

    expect(
      out.find((n) => n.id === "loose-output")!.position!.x,
    ).toBeGreaterThan(out.find((n) => n.id === "loose-source")!.position!.x);
  });
});

describe("layoutWithFolders (dag mode)", () => {
  // The pipeline's case: three folders (Datasets / UDFs / Widgets) with
  // cross-folder edges (dataset → udf → widget). In dag mode the GLOBAL graph
  // drives positioning, so a source sits left of its target and each folder's
  // box bounds its members (no per-folder band stacking).
  it("lays a cross-folder pipeline out as a left→right DAG with bounding-box folders", () => {
    const nodes = [node("ds"), node("udf"), node("wid")];
    const edges = [
      { source: "ds", target: "udf" },
      { source: "udf", target: "wid" },
    ];
    const { nodes: out, folderBoxes } = layoutWithFolders(
      nodes,
      edges,
      [folder("d", ["ds"]), folder("t", ["udf"]), folder("v", ["wid"])],
      new Map([
        ["ds", "d"],
        ["udf", "t"],
        ["wid", "v"],
      ]),
      fixedSize,
      "horizontal",
      "dag",
    );

    const ds = out.find((n) => n.id === "ds")!;
    const udf = out.find((n) => n.id === "udf")!;
    const wid = out.find((n) => n.id === "wid")!;

    // Source left of target left of sink (rankdir LR, driven by the real edges).
    expect(ds.position!.x).toBeLessThan(udf.position!.x);
    expect(udf.position!.x).toBeLessThan(wid.position!.x);

    // Each folder's box bounds exactly its member (not a band-stacked column).
    const boxD = folderBoxes.find((f) => f.id === "d")!;
    const boxT = folderBoxes.find((f) => f.id === "t")!;
    const boxV = folderBoxes.find((f) => f.id === "v")!;
    expect(inside(boxD, ds)).toBe(true);
    expect(inside(boxT, udf)).toBe(true);
    expect(inside(boxV, wid)).toBe(true);

    // The box wraps its member with padding, not a wide cross-axis band: its
    // width is just the node + 2*pad (proves it is a per-member bounding box).
    expect(boxD.width).toBeLessThan(fixedSize().width + 120);
  });

  it("spreads DISCONNECTED nodes across layer columns instead of clustering them (the fix)", () => {
    // The real pipeline case: edges are sparse — here only ONE udf→widget edge
    // exists, and every dataset + most UDFs are disconnected. Pure dagre would
    // pile all disconnected nodes into column 0; the layer-anchor pinning must
    // still spread them Data → Transform → View left→right.
    const ds = (id: string) => node(id, { layer: "data" });
    const udf = (id: string) => node(id, { layer: "transform" });
    const wid = (id: string) => node(id, { layer: "view" });
    const nodes = [
      ds("d1"),
      ds("d2"),
      udf("u1"),
      udf("u2"), // u2 is disconnected
      wid("w1"),
      wid("w2"), // w2 is disconnected
    ];
    const edges = [{ source: "u1", target: "w1" }]; // the ONLY edge
    const { nodes: out } = layoutWithFolders(
      nodes,
      edges,
      [
        folder("data", ["d1", "d2"]),
        folder("xf", ["u1", "u2"]),
        folder("view", ["w1", "w2"]),
      ],
      new Map([
        ["d1", "data"],
        ["d2", "data"],
        ["u1", "xf"],
        ["u2", "xf"],
        ["w1", "view"],
        ["w2", "view"],
      ]),
      fixedSize,
      "horizontal",
      "dag",
    );
    const x = (id: string) => out.find((n) => n.id === id)!.position!.x;
    // Every data node is left of every (even disconnected) transform node,
    // which is left of every (even disconnected) view node.
    const dataMaxX = Math.max(x("d1"), x("d2"));
    const xfMinX = Math.min(x("u1"), x("u2"));
    const xfMaxX = Math.max(x("u1"), x("u2"));
    const viewMinX = Math.min(x("w1"), x("w2"));
    expect(dataMaxX).toBeLessThan(xfMinX);
    expect(xfMaxX).toBeLessThan(viewMinX);
    // The disconnected nodes share their layer's column (not stranded at 0).
    expect(x("u2")).toBe(x("u1"));
    expect(x("d2")).toBe(x("d1"));
  });

  it("bounds a multi-member folder around all its members", () => {
    const nodes = [node("a"), node("b"), node("c"), node("out")];
    const edges = [
      { source: "a", target: "out" },
      { source: "b", target: "out" },
      { source: "c", target: "out" },
    ];
    const { nodes: out, folderBoxes } = layoutWithFolders(
      nodes,
      edges,
      [folder("inputs", ["a", "b", "c"]), folder("sink", ["out"])],
      new Map([
        ["a", "inputs"],
        ["b", "inputs"],
        ["c", "inputs"],
        ["out", "sink"],
      ]),
      fixedSize,
      "horizontal",
      "dag",
    );
    const box = folderBoxes.find((f) => f.id === "inputs")!;
    for (const id of ["a", "b", "c"]) {
      expect(inside(box, out.find((n) => n.id === id)!)).toBe(true);
    }
    // The sink is fed by all three inputs → it ranks to the right of them.
    const outNode = out.find((n) => n.id === "out")!;
    for (const id of ["a", "b", "c"]) {
      expect(outNode.position!.x).toBeGreaterThan(
        out.find((n) => n.id === id)!.position!.x,
      );
    }
  });

  it("keeps ungrouped nodes at their global DAG positions (no band shift)", () => {
    const nodes = [node("grouped"), node("loose")];
    const edges = [{ source: "grouped", target: "loose" }];
    const { nodes: out } = layoutWithFolders(
      nodes,
      edges,
      [folder("f1", ["grouped"])],
      new Map([["grouped", "f1"]]),
      fixedSize,
      "horizontal",
      "dag",
    );
    const loose = out.find((n) => n.id === "loose")!;
    const grouped = out.find((n) => n.id === "grouped")!;
    expect(loose.position).toBeDefined();
    // The ungrouped target ranks right of its source via the global DAG.
    expect(loose.position!.x).toBeGreaterThan(grouped.position!.x);
  });

  it("honors authored folder geometry in dag mode", () => {
    const { folderBoxes } = layoutWithFolders(
      [node("a")],
      [],
      [
        folder("f1", ["a"], {
          position: { x: 800, y: 900 },
          size: { width: 500, height: 400 },
        }),
      ],
      new Map([["a", "f1"]]),
      fixedSize,
      "horizontal",
      "dag",
    );
    expect(folderBoxes[0]).toMatchObject({
      x: 800,
      y: 900,
      width: 500,
      height: 400,
    });
  });

  it("renders a collapsed folder as a short summary bar in dag mode", () => {
    const { folderBoxes } = layoutWithFolders(
      [node("a"), node("b")],
      [],
      [folder("f1", ["a", "b"], { collapsed: true })],
      new Map([
        ["a", "f1"],
        ["b", "f1"],
      ]),
      fixedSize,
      "horizontal",
      "dag",
    );
    const box = folderBoxes[0];
    expect(box.collapsed).toBe(true);
    expect(box.height).toBeLessThan(100); // summary bar, not stacked height
  });

  it("separates derived folder bands the global DAG would overlap (the overlap fix)", () => {
    // A reference used both early and late puts folder A at ranks 0 AND 2, so its
    // bounding box spans folder B (rank 1) — the pre-fix overlap, worst with the
    // large nodes of detailed mode. The separation pass must pull the boxes apart
    // by at least the band gap along the band axis.
    const big = () => ({ width: 480, height: 600 });
    const nodes = [node("a0"), node("b1"), node("a2")];
    const edges = [
      { source: "a0", target: "b1" },
      { source: "b1", target: "a2" },
    ];
    const { folderBoxes } = layoutWithFolders(
      nodes,
      edges,
      [folder("A", ["a0", "a2"]), folder("B", ["b1"])],
      new Map([
        ["a0", "A"],
        ["a2", "A"],
        ["b1", "B"],
      ]),
      big,
      "horizontal",
      "dag",
    );
    const boxA = folderBoxes.find((f) => f.id === "A")!;
    const boxB = folderBoxes.find((f) => f.id === "B")!;
    // Whichever box is left, the other starts at least one band gap past its right
    // edge — i.e. the boxes no longer intersect along the band axis.
    const [left, right] = boxA.x <= boxB.x ? [boxA, boxB] : [boxB, boxA];
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width + FOLDER_BAND_GAP);
  });

  it("orders bands by CONFIG order, not dagre coordinate (mode-independent — the swap fix)", () => {
    // The edge nodeB → nodeA makes dagre rank nodeB LEFT of nodeA (B.x < A.x). The
    // config order is [A, B], so the bands must still come out A-left-of-B. Sorting
    // by the placed coordinate (the old behaviour) would follow dagre and flip them —
    // which is exactly how compact ↔ detailed swapped References and Data sources.
    const nodes = [node("nodeA"), node("nodeB")];
    const edges = [{ source: "nodeB", target: "nodeA" }];
    const { folderBoxes } = layoutWithFolders(
      nodes,
      edges,
      [folder("A", ["nodeA"]), folder("B", ["nodeB"])],
      new Map([
        ["nodeA", "A"],
        ["nodeB", "B"],
      ]),
      fixedSize,
      "horizontal",
      "dag",
    );
    const boxA = folderBoxes.find((f) => f.id === "A")!;
    const boxB = folderBoxes.find((f) => f.id === "B")!;
    // Config order [A, B] wins over dagre's B→A ranking → A stays left of B.
    expect(boxA.x).toBeLessThan(boxB.x);
  });

  // Safety property: omitting the layout mode is byte-identical to "dtv" — the
  // dag path is purely opt-in and never perturbs the default.
  it("is byte-identical between an omitted layout mode and explicit dtv", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const folders = [folder("f1", ["a", "b"]), folder("f2", ["c"])];
    const nf = new Map([
      ["a", "f1"],
      ["b", "f1"],
      ["c", "f2"],
    ]);
    const omitted = layoutWithFolders(
      nodes,
      edges,
      folders,
      nf,
      fixedSize,
      "horizontal",
    );
    const explicit = layoutWithFolders(
      nodes,
      edges,
      folders,
      nf,
      fixedSize,
      "horizontal",
      "dtv",
    );
    expect(explicit).toEqual(omitted);
  });
});
