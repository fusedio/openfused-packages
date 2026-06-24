// task-tree.test.ts — the pure delegation-forest builder (ported 1:1 from the app
// app/src/ui/lib/taskTree.test.ts, retyped against the widget's Task shape). The
// builder assembles the parentId SKELETON; blockedBy is an annotation read off
// each task, never a structural edge (spec/app-task-tree.md §1).
import { describe, expect, it } from "vitest";
import {
  ancestorChain,
  buildTaskForest,
  dependentsOf,
  filterTaskForest,
  type TaskTreeNode,
} from "../task-tree";
import type { Task } from "../task-board-shared";

/** A minimal widget Task; order-preserving createdAt stamp per call. */
function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    project: "p",
    number: 1,
    title: id,
    description: "",
    status: "todo",
    agentId: null,
    createdBy: "user",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    parentId: null,
    blockedBy: [],
    runs: [],
    isLive: false,
    liveRunCount: 0,
    ...overrides,
  };
}

/** Flatten a forest to "id@depth" strings in render order. */
function flatten(forest: TaskTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: TaskTreeNode[]) => {
    for (const n of nodes) {
      out.push(`${n.task.id}@${n.depth}`);
      walk(n.children);
    }
  };
  walk(forest);
  return out;
}

describe("buildTaskForest", () => {
  it("builds the forest shape from a flat list, nesting by parentId", () => {
    const tasks = [
      task("root", { createdAt: "2026-06-17T00:00:00Z" }),
      task("pm", { parentId: "root", createdAt: "2026-06-17T00:01:00Z" }),
      task("w1", { parentId: "pm", createdAt: "2026-06-17T00:02:00Z" }),
      task("w2", { parentId: "pm", createdAt: "2026-06-17T00:03:00Z" }),
    ];
    expect(flatten(buildTaskForest(tasks))).toEqual(["root@0", "pm@1", "w1@2", "w2@2"]);
  });

  it("renders a task whose parent is not in the set as a root (orphan-as-root)", () => {
    const tasks = [task("orphan", { parentId: "missing" })];
    const forest = buildTaskForest(tasks);
    expect(forest).toHaveLength(1);
    expect(forest[0].task.id).toBe("orphan");
    expect(forest[0].depth).toBe(0);
  });

  it("orders roots newest-first and children oldest-first", () => {
    const tasks = [
      task("oldRoot", { createdAt: "2026-06-17T00:00:00Z" }),
      task("newRoot", { createdAt: "2026-06-17T00:10:00Z" }),
      task("childB", { parentId: "newRoot", createdAt: "2026-06-17T00:20:00Z" }),
      task("childA", { parentId: "newRoot", createdAt: "2026-06-17T00:15:00Z" }),
    ];
    expect(flatten(buildTaskForest(tasks))).toEqual([
      "newRoot@0",
      "childA@1",
      "childB@1",
      "oldRoot@0",
    ]);
  });

  it("renders a standalone task (no parent, no children) as a single root", () => {
    const forest = buildTaskForest([task("solo")]);
    expect(forest).toHaveLength(1);
    expect(forest[0].children).toEqual([]);
  });

  it("is cycle-safe: a self/mutual parentId cycle never loops", () => {
    const tasks = [task("a", { parentId: "b" }), task("b", { parentId: "a" })];
    const forest = buildTaskForest(tasks);
    expect(() => flatten(forest)).not.toThrow();
    const selfLoop = buildTaskForest([task("x", { parentId: "x" })]);
    expect(() => flatten(selfLoop)).not.toThrow();
  });
});

describe("filterTaskForest", () => {
  const tasks = [
    task("root", { title: "architect" }),
    task("pm", { parentId: "root", title: "manager" }),
    task("worker", { parentId: "pm", title: "needle" }),
    task("sibling", { parentId: "root", title: "other" }),
  ];

  it("keeps the ancestor chain of a matched descendant", () => {
    const filtered = filterTaskForest(buildTaskForest(tasks), (t) => t.title === "needle");
    expect(flatten(filtered)).toEqual(["root@0", "pm@1", "worker@2"]);
  });

  it("drops a whole subtree with no match", () => {
    const filtered = filterTaskForest(buildTaskForest(tasks), (t) => t.title === "nope");
    expect(filtered).toEqual([]);
  });
});

describe("dependentsOf", () => {
  it("reverse-resolves blockedBy edges", () => {
    const tasks = [task("a"), task("b", { blockedBy: ["a"] }), task("c", { blockedBy: ["a"] })];
    expect(dependentsOf("a", tasks).sort()).toEqual(["b", "c"]);
    expect(dependentsOf("b", tasks)).toEqual([]);
  });
});

describe("ancestorChain", () => {
  it("walks parentId from the root down to the task (exclusive)", () => {
    const tasks = [
      task("root"),
      task("pm", { parentId: "root" }),
      task("worker", { parentId: "pm" }),
    ];
    expect(ancestorChain("worker", tasks).map((t) => t.id)).toEqual(["root", "pm"]);
    expect(ancestorChain("root", tasks)).toEqual([]);
  });

  it("is cycle-safe", () => {
    const tasks = [task("a", { parentId: "b" }), task("b", { parentId: "a" })];
    expect(() => ancestorChain("a", tasks)).not.toThrow();
  });
});
