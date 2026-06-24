// task-board.test.tsx — behavioral guard for the executor-seam write path.
//
// Writes go through the GENERIC event-triggered executor (`bridge.udfs.execute`,
// spec/json-ui-app.md §11), NOT the old read-SQL-path mutate hack. A drag-move /
// cancel fires the packaged `_core.task-management.update_status` UDF and a create
// fires `_core.task-management.create`, once each per op with the mutation as
// overrides. This test asserts onMoveTask / onCreateTask call `bridge.udfs.execute`
// with the right `_core` udf name + overrides, and that the create dialog gate keys
// off a clean ack (true) vs a write error (false).
//
// Approach: same as bar-chart.test.tsx — mock the SDK hooks + React hooks to
// identities, call the component function directly, extract the seam props
// (onMoveTask / onCreateTask) from the returned tree, then call them and inspect the
// `execute` spy.

import { describe, it, expect, vi } from "vitest";
import React from "react";

// ── the bridge spies: udfs.execute (the write seam) + params.set (the refetch) ──
// Typed to the `bridge.udfs.execute` envelope ({data, error}) so per-test
// `mockResolvedValueOnce` overrides with other shapes (a dict ack, `data: null`
// on error) type-check — the default impl alone would narrow `data`/`error` too far.
const execute = vi.fn(
  async (): Promise<{ data: unknown; error: string | null }> => ({
    data: { ok: true },
    error: null,
  }),
);
const paramsSet = vi.fn();

// ── mock the SDK hooks ──────────────────────────────────────────────────────────
vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({ rows: [], loading: false, error: null }),
  useFusedWidgetBridge: () => ({
    params: { set: paramsSet },
    udfs: { execute },
  }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

// ── mock React hooks to identities ──────────────────────────────────────────────
// useCallback is identity → the seam handlers ARE the raw functions; useMemo runs
// its factory; useState returns [initial, noop] (no state transitions are exercised
// here — the write fires through the execute spy, not a setState capture).
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const useState = (initial: unknown) => [initial, () => {}];
  const useEffect = () => {};
  const useCallback = (fn: unknown) => fn;
  const useMemo = (fn: () => unknown) => fn();
  const useRef = (v: unknown) => ({ current: v });
  const useContext = () => null;
  const patched = {
    ...actual,
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    useContext,
  };
  return { ...patched, default: patched };
});

// Import AFTER mocks so the component closes over the mocked hooks.
const { default: definition } = await import("../task-board");

type CreateTaskInput = {
  prompt: string;
  agent: string | undefined;
  project: string;
};
type Overrides = Record<string, unknown>;

/** Walk a React element tree depth-first and return the first prop named `name`. */
function findProp<T>(node: unknown, name: string): T | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findProp<T>(n, name);
      if (f) return f;
    }
    return null;
  }
  const el = node as React.ReactElement;
  const props = el.props as Record<string, unknown> | undefined;
  if (!props) return null;
  if (typeof props[name] === "function") return props[name] as T;
  if (props.children !== undefined) return findProp<T>(props.children, name);
  return null;
}

const Component = (
  definition as { component: React.ComponentType<{ element: unknown }> }
).component;

/** Render TaskBoard (optionally with extra props) and return the first seam prop. */
function getSeam<T>(name: string, props: Record<string, unknown> = {}): T {
  const tree = (Component as unknown as (p: { element: unknown }) => unknown)({
    element: { type: "task-board", props, children: [] },
  });
  const fn = findProp<T>(tree, name);
  if (!fn) throw new Error(`${name} prop not found in tree`);
  return fn;
}

describe("task-board executor write seam (_core CRUD)", () => {
  it("onMoveTask fires _core update_status with {id, status}", () => {
    execute.mockClear();
    const onMoveTask = getSeam<(id: string, status: string) => void>("onMoveTask");
    onMoveTask("t-001", "in_progress");

    expect(execute).toHaveBeenCalledTimes(1);
    const [udf, overrides] = execute.mock.calls[0] as unknown as [string, Overrides];
    expect(udf).toBe("_core.task-management.update_status");
    expect(overrides).toMatchObject({
      id: "t-001",
      status: "in_progress",
    });
  });

  it("onCreateTask fires _core create with client id + project + title/description from the prompt", () => {
    execute.mockClear();
    const onCreateTask = getSeam<(i: CreateTaskInput) => void>("onCreateTask");
    onCreateTask({ prompt: "build a chart", agent: undefined, project: "my-project" });

    expect(execute).toHaveBeenCalledTimes(1);
    const [udf, overrides] = execute.mock.calls[0] as unknown as [string, Overrides];
    expect(udf).toBe("_core.task-management.create");
    expect(overrides).toMatchObject({
      id: expect.any(String),
      project: "my-project",
      title: "build a chart",
      description: "build a chart",
    });
  });

  // The create dialog closes only on a successful ack (it awaits this result), so
  // onCreateTask must resolve true on a clean write and false on an error.
  it("onCreateTask resolves true on a clean ack", async () => {
    execute.mockClear();
    execute.mockResolvedValueOnce({ data: [{ ok: true }], error: null });
    const onCreateTask =
      getSeam<(i: CreateTaskInput) => Promise<boolean>>("onCreateTask");
    await expect(
      onCreateTask({ prompt: "ok task", agent: undefined, project: "p" }),
    ).resolves.toBe(true);
  });

  it("onCreateTask resolves false when the write errors (dialog stays open)", async () => {
    execute.mockClear();
    execute.mockResolvedValueOnce({ data: null, error: "boom" });
    const onCreateTask =
      getSeam<(i: CreateTaskInput) => Promise<boolean>>("onCreateTask");
    await expect(
      onCreateTask({ prompt: "bad task", agent: undefined, project: "p" }),
    ).resolves.toBe(false);
  });
});

describe("task-board _core cancel + assign chain", () => {
  it("a cancel move maps to update_status with status 'cancelled'", async () => {
    execute.mockClear();
    const onMoveTask = getSeam<(id: string, status: string) => void>("onMoveTask");
    onMoveTask("t-002", "cancelled");
    const [udf, overrides] = execute.mock.calls[0] as unknown as [string, Overrides];
    expect(udf).toBe("_core.task-management.update_status");
    expect(overrides).toMatchObject({ id: "t-002", status: "cancelled" });
  });

  it("create with an assignee chains create → assign(newId, agentId)", async () => {
    execute.mockClear();
    // create returns the new task record; the assign call follows.
    execute.mockResolvedValueOnce({ data: [{ id: "task_new" }], error: null });
    execute.mockResolvedValueOnce({ data: [{ ok: true }], error: null });
    const onCreateTask = getSeam<(i: CreateTaskInput) => Promise<boolean>>("onCreateTask");
    await onCreateTask({ prompt: "load parquet", agent: "agent_42", project: "demo" });

    expect(execute).toHaveBeenCalledTimes(2);
    const [createUdf, createOv] = execute.mock.calls[0] as unknown as [string, Overrides];
    expect(createUdf).toBe("_core.task-management.create");
    expect(createOv).toMatchObject({ project: "demo", title: "load parquet" });
    const [assignUdf, assignOv] = execute.mock.calls[1] as unknown as [string, Overrides];
    expect(assignUdf).toBe("_core.task-management.assign");
    expect(assignOv).toMatchObject({ id: "task_new", agent_id: "agent_42" });
  });

  it("create with no assignee fires only create (no assign chain)", async () => {
    execute.mockClear();
    execute.mockResolvedValueOnce({ data: [{ id: "task_x" }], error: null });
    const onCreateTask = getSeam<(i: CreateTaskInput) => Promise<boolean>>("onCreateTask");
    await onCreateTask({ prompt: "no assignee", agent: undefined, project: "demo" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls[0] as unknown as [string, Overrides])[0]).toBe(
      "_core.task-management.create",
    );
  });
});
