import { describe, it, expect } from "vitest";

import {
  addComment,
  addReply,
  capCommentsForUrl,
  deleteComment,
  editContent,
  normalizeComments,
  reanchor,
  reopenComment,
  resolveComment,
  sortComments,
} from "../canvas-comments";
import type { CanvasComment } from "../canvas-types";

function mk(partial: Partial<CanvasComment> & { id: string }): CanvasComment {
  return {
    content: "c",
    author: "human",
    status: "open",
    replies: [],
    createdAt: 0,
    ...partial,
  };
}

describe("normalizeComments", () => {
  it("returns [] for non-arrays and unparseable input", () => {
    expect(normalizeComments(undefined)).toEqual([]);
    expect(normalizeComments(null)).toEqual([]);
    expect(normalizeComments("nope")).toEqual([]);
    expect(normalizeComments({ id: "x" })).toEqual([]);
  });

  it("drops blank-content root threads (symmetric filter)", () => {
    const out = normalizeComments([
      { id: "a", content: "real", author: "human", createdAt: 1 },
      { id: "b", content: "   ", author: "human", createdAt: 2 },
      { id: "c", content: "", author: "human", createdAt: 3 },
      { id: "d" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("drops blank replies but keeps the thread", () => {
    const out = normalizeComments([
      {
        id: "a",
        content: "root",
        createdAt: 1,
        replies: [
          { id: "r1", content: "ok", createdAt: 2 },
          { id: "r2", content: "  ", createdAt: 3 },
        ],
      },
    ]);
    expect(out[0].replies?.map((r) => r.id)).toEqual(["r1"]);
  });

  it("defaults missing status to open and trims content", () => {
    const out = normalizeComments([
      { id: "a", content: "  hi  ", createdAt: 1 },
    ]);
    expect(out[0].status).toBe("open");
    expect(out[0].content).toBe("hi");
  });

  it("keeps the anchor only when anchorId is a non-empty string", () => {
    const out = normalizeComments([
      {
        id: "a",
        content: "x",
        createdAt: 1,
        anchorId: "sales",
        offsetX: 5,
        offsetY: 6,
      },
      { id: "b", content: "y", createdAt: 2, anchorId: "", x: 10, y: 20 },
    ]);
    expect(out[0].anchorId).toBe("sales");
    expect(out[0].offsetX).toBe(5);
    expect(out[1].anchorId).toBeUndefined();
    expect(out[1].x).toBe(10);
  });
});

describe("sortComments", () => {
  it("orders by createdAt asc, codepoint tiebreak on id, non-numeric → 0", () => {
    const out = sortComments([
      mk({ id: "z", createdAt: 2 }),
      mk({ id: "b", createdAt: 1 }),
      mk({ id: "a", createdAt: 1 }),
      // non-numeric createdAt coerces to 0 → sorts first
      mk({ id: "first", createdAt: "x" as unknown as number }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["first", "a", "b", "z"]);
  });
});

describe("mutators are immutable and correct", () => {
  it("addComment normalizes + sorts and does not mutate input", () => {
    const list = [mk({ id: "a", createdAt: 2 })];
    const next = addComment(list, mk({ id: "b", createdAt: 1 }));
    expect(next.map((c) => c.id)).toEqual(["b", "a"]);
    expect(list).toHaveLength(1);
  });

  it("editContent updates content + updatedAt for the target only", () => {
    const list = [mk({ id: "a", content: "old", createdAt: 1 })];
    const next = editContent(list, "a", "new", 99);
    expect(next[0].content).toBe("new");
    expect(next[0].updatedAt).toBe(99);
    expect(list[0].content).toBe("old");
  });

  it("addReply appends a reply without mutating the input thread", () => {
    const list = [mk({ id: "a", createdAt: 1 })];
    const next = addReply(
      list,
      "a",
      { id: "r1", content: "reply", author: "agent", createdAt: 2 },
      2,
    );
    expect(next[0].replies?.map((r) => r.id)).toEqual(["r1"]);
    expect(list[0].replies).toEqual([]);
  });

  it("resolveComment stamps status/resolvedBy/resolvedAt; reopen clears them", () => {
    const resolved = resolveComment(
      [mk({ id: "a", createdAt: 1 })],
      "a",
      "agent",
      50,
    );
    expect(resolved[0]).toMatchObject({
      status: "resolved",
      resolvedBy: "agent",
      resolvedAt: 50,
    });
    const reopened = reopenComment(resolved, "a", 60);
    expect(reopened[0].status).toBe("open");
    expect(reopened[0].resolvedBy).toBeUndefined();
    expect(reopened[0].resolvedAt).toBeUndefined();
  });

  it("deleteComment removes the target", () => {
    const next = deleteComment(
      [mk({ id: "a", createdAt: 1 }), mk({ id: "b", createdAt: 2 })],
      "a",
    );
    expect(next.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("reanchor", () => {
  it("drops the anchor of comments whose node id is gone, keeping x/y", () => {
    const list = [
      mk({
        id: "a",
        anchorId: "sales",
        offsetX: 4,
        offsetY: 8,
        x: 100,
        y: 200,
        createdAt: 1,
      }),
      mk({ id: "b", anchorId: "units", x: 5, y: 6, createdAt: 2 }),
    ];
    const out = reanchor(list, new Set(["units"]));
    expect(out[0].anchorId).toBeUndefined();
    expect(out[0].offsetX).toBeUndefined();
    expect(out[0].x).toBe(100);
    expect(out[1].anchorId).toBe("units");
  });
});

describe("capCommentsForUrl", () => {
  it("drops oldest resolved threads first, never open ones, until under budget", () => {
    const big = "x".repeat(400);
    const list = [
      mk({ id: "open1", status: "open", content: big, createdAt: 1 }),
      mk({ id: "res1", status: "resolved", content: big, createdAt: 2 }),
      mk({ id: "res2", status: "resolved", content: big, createdAt: 3 }),
    ];
    const { kept, dropped } = capCommentsForUrl(list, 600);
    expect(dropped).toBeGreaterThan(0);
    // open thread is always kept
    expect(kept.some((c) => c.id === "open1")).toBe(true);
    // the oldest resolved (res1) is dropped before res2
    expect(kept.some((c) => c.id === "res1")).toBe(false);
  });

  it("keeps everything when under budget", () => {
    const list = [mk({ id: "a", createdAt: 1 })];
    const { kept, dropped } = capCommentsForUrl(list, 10_000);
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

describe("in_progress status survives normalize + mutators (regression)", () => {
  it("normalizeComments preserves in_progress (does not downgrade to open)", () => {
    const out = normalizeComments([
      { id: "a", content: "x", status: "in_progress", createdAt: 1 },
    ]);
    expect(out[0].status).toBe("in_progress");
  });

  it("adding a comment does not clobber an in_progress task back to open", () => {
    const list = normalizeComments([
      { id: "a", content: "working", status: "in_progress", createdAt: 1 },
    ]);
    const next = addComment(
      list,
      mk({ id: "b", content: "new", status: "open", createdAt: 2 }),
    );
    expect(next.find((c) => c.id === "a")?.status).toBe("in_progress");
    expect(next.find((c) => c.id === "b")?.status).toBe("open");
  });

  it("deleting one comment keeps the others' in_progress intact", () => {
    const list = normalizeComments([
      { id: "a", content: "working", status: "in_progress", createdAt: 1 },
      { id: "b", content: "gone", status: "open", createdAt: 2 },
    ]);
    const next = deleteComment(list, "b");
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("in_progress");
  });

  it("an unknown status falls back to open", () => {
    const out = normalizeComments([
      { id: "a", content: "x", status: "bogus", createdAt: 1 },
    ]);
    expect(out[0].status).toBe("open");
  });
});
