// task-row.test.ts — the seam-① row → Task coercion. The tree view (and the
// blockedBy "waiting on" overlay) need parentId + blockedBy carried through from
// the resolved rows; list_tasks emits them camelCased (TaskRecord aliases), so
// toTask must map them (defensively) onto the client Task.
import { describe, expect, it } from "vitest";
import { toTask } from "../task-board-shared";

describe("toTask — parentId / blockedBy (tree skeleton + dependency annotation)", () => {
  it("maps parentId from the row", () => {
    expect(toTask({ id: "t1", parentId: "p0" }).parentId).toBe("p0");
  });

  it("normalizes a missing / empty parentId to null", () => {
    expect(toTask({ id: "t1" }).parentId).toBeNull();
    expect(toTask({ id: "t1", parentId: "" }).parentId).toBeNull();
    expect(toTask({ id: "t1", parentId: null }).parentId).toBeNull();
  });

  it("maps a blockedBy array of task ids", () => {
    expect(toTask({ id: "t1", blockedBy: ["a", "b"] }).blockedBy).toEqual(["a", "b"]);
  });

  it("parses a JSON-string blockedBy (DuckDB list column may arrive serialized)", () => {
    expect(toTask({ id: "t1", blockedBy: '["a","b"]' }).blockedBy).toEqual(["a", "b"]);
  });

  it("defaults blockedBy to an empty array when absent or malformed", () => {
    expect(toTask({ id: "t1" }).blockedBy).toEqual([]);
    expect(toTask({ id: "t1", blockedBy: "not-json" }).blockedBy).toEqual([]);
    expect(toTask({ id: "t1", blockedBy: 42 }).blockedBy).toEqual([]);
  });
});
