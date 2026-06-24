// task-tree.ts — the task-tree builder (ported 1:1 from app/src/ui/lib/taskTree.ts,
// spec/app-task-tree.md §2/§3) — pure, no React. Builds the delegation forest from
// the flat task list: group by `parentId`, attach children, compute depth. The two
// graphs the view draws are kept distinct (§1): `parentId` is the SKELETON
// (nesting); `blockedBy` is an ANNOTATION (a "waiting on" badge + hover overlay) —
// this builder only assembles the `parentId` skeleton; `blockedBy` never moves a node.
import type { Task } from "./task-board-shared";

/** A node in the delegation forest. Derived client-side; NOT a persisted shape. */
export interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
  /** Distance from this node's root along `parentId` (0 for a root). */
  depth: number;
}

/**
 * A task is a forest ROOT when it has no parent OR its parent is not in the
 * current set (an orphan whose parent was filtered out / lives elsewhere). The
 * flat List/Board views reuse this so their root set matches the tree exactly.
 */
export function isForestRoot(task: Task, byId: ReadonlyMap<string, unknown>): boolean {
  return task.parentId === null || !byId.has(task.parentId);
}

/**
 * Build the delegation forest from a flat task list (§3):
 * - Roots: `parentId === null` OR a parent not in the set (orphan-as-root).
 * - Children nest under their parent, oldest-first (creation order).
 * - Roots ordered newest-first (matching the list default).
 * - Cycle-safe: a visited set guards the depth walk.
 */
export function buildTaskForest(tasks: Task[]): TaskTreeNode[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);

  const childrenByParent = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    if (isForestRoot(task, byId)) {
      roots.push(task);
    } else {
      const siblings = childrenByParent.get(task.parentId as string) ?? [];
      siblings.push(task);
      childrenByParent.set(task.parentId as string, siblings);
    }
  }

  const compareCreatedAsc = (a: Task, b: Task) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  for (const siblings of childrenByParent.values()) siblings.sort(compareCreatedAsc);
  roots.sort((a, b) => -compareCreatedAsc(a, b));

  const build = (task: Task, depth: number, visited: Set<string>): TaskTreeNode => {
    visited.add(task.id);
    const kids = childrenByParent.get(task.id) ?? [];
    const children = kids
      .filter((child) => !visited.has(child.id))
      .map((child) => build(child, depth + 1, visited));
    return { task, children, depth };
  };

  return roots.map((root) => build(root, 0, new Set<string>()));
}

/**
 * Filter the forest by a predicate while keeping the ANCESTOR CHAIN of any match
 * visible (§4.1) — a matched child is never orphaned. A node is kept when it
 * matches OR has a kept descendant. Returns a new forest (input untouched).
 */
export function filterTaskForest(
  forest: TaskTreeNode[],
  matches: (task: Task) => boolean,
): TaskTreeNode[] {
  const visit = (node: TaskTreeNode): TaskTreeNode | null => {
    const keptChildren = node.children
      .map(visit)
      .filter((child): child is TaskTreeNode => child !== null);
    if (matches(node.task) || keptChildren.length > 0) {
      return { task: node.task, children: keptChildren, depth: node.depth };
    }
    return null;
  };
  return forest.map(visit).filter((node): node is TaskTreeNode => node !== null);
}

/**
 * The task ids that depend on `taskId` — the reverse `blockedBy` lookup (§1, §2),
 * used to highlight a node's dependents on hover/focus alongside its blockers.
 */
export function dependentsOf(taskId: string, tasks: Task[]): string[] {
  return tasks.filter((t) => t.blockedBy.includes(taskId)).map((t) => t.id);
}

/**
 * The parent breadcrumb for a task (§4.2): the `parentId` chain from the root down
 * to (but not including) the task itself, cycle-safe via a visited guard.
 */
export function ancestorChain(taskId: string, tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);
  const chain: Task[] = [];
  const visited = new Set<string>([taskId]);
  let current = byId.get(taskId)?.parentId ?? null;
  while (current && byId.has(current) && !visited.has(current)) {
    visited.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    chain.unshift(parent);
    current = parent.parentId;
  }
  return chain;
}
