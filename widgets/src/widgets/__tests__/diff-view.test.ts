import { describe, it, expect } from "vitest";

import { computeLineDiff, classifyUnifiedLine } from "../../diff-view";

// The diff widget's "before/after" mode computes a line-level diff via LCS. These
// assert the COMPUTED line classification — the foundation of the rendered +/-.
describe("computeLineDiff", () => {
  it("marks unchanged lines as context", () => {
    const d = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(d.map((l) => l.kind)).toEqual(["ctx", "ctx", "ctx"]);
    expect(d.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("detects a single changed line as a del followed by an add", () => {
    const d = computeLineDiff("a\nb\nc", "a\nB\nc");
    expect(d).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "ctx", text: "c" },
    ]);
  });

  it("detects pure additions at the end", () => {
    const d = computeLineDiff("a\nb", "a\nb\nc\nd");
    expect(d).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "ctx", text: "b" },
      { kind: "add", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("detects pure deletions", () => {
    const d = computeLineDiff("a\nb\nc", "a\nc");
    expect(d).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "ctx", text: "c" },
    ]);
  });

  it("treats empty before as all-add and empty after as all-del", () => {
    expect(computeLineDiff("", "x\ny").map((l) => l.kind)).toEqual(["add", "add"]);
    expect(computeLineDiff("x\ny", "").map((l) => l.kind)).toEqual(["del", "del"]);
  });

  it("ignores a single trailing newline difference", () => {
    expect(computeLineDiff("a\nb\n", "a\nb").map((l) => l.kind)).toEqual(["ctx", "ctx"]);
  });

  it("returns no changes for two empty inputs", () => {
    expect(computeLineDiff("", "")).toEqual([]);
  });
});

// The "diff" mode renders a precomputed git unified-diff string. These assert each
// line is colored by its leading marker (and that +++/--- file headers are meta,
// not adds/dels).
describe("classifyUnifiedLine", () => {
  it("classifies content markers", () => {
    expect(classifyUnifiedLine("+added")).toBe("add");
    expect(classifyUnifiedLine("-removed")).toBe("del");
    expect(classifyUnifiedLine(" unchanged")).toBe("ctx");
    expect(classifyUnifiedLine("@@ -1,2 +1,3 @@")).toBe("hunk");
  });

  it("classifies file headers as meta (NOT add/del)", () => {
    expect(classifyUnifiedLine("diff --git a/x b/x")).toBe("meta");
    expect(classifyUnifiedLine("index abc..def 100644")).toBe("meta");
    expect(classifyUnifiedLine("+++ b/x")).toBe("meta");
    expect(classifyUnifiedLine("--- a/x")).toBe("meta");
  });
});
