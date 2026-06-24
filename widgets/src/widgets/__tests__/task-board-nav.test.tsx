// task-board-nav.test.tsx — click-through via the GENERIC host nav seam
// (OpenfusedHost.navigate, surfaces.md §11). The widget builds a path from its
// route-template props (taskHref / boardHref) and calls the host's navigate(path);
// the host (app surface) performs the route push. With no host (deploy-serve /
// parley standalone) navigate is absent → the open seam is undefined and rows
// render inert (asserted below).
//
// Approach mirrors task-board.test.tsx: mock the SDK + React hooks to identities,
// useContext returns the OpenfusedHost value, render the component fn directly, and
// pull the seam the outer component hands the view.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

const navigate = vi.fn();
// The OpenfusedHost value useContext returns for this run. null → off-host.
let host: { navigate?: typeof navigate } | null = { navigate };

vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({ rows: [], loading: false, error: null }),
  useFusedWidgetBridge: () => ({ params: { set: vi.fn() }, udfs: { execute: vi.fn() } }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const patched = {
    ...actual,
    useState: (initial: unknown) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (v: unknown) => ({ current: v }),
    useContext: () => host, // OpenfusedHostContext value (useOpenfusedHost ?? {})
  };
  return { ...patched, default: patched };
});

const { default: definition } = await import("../task-board");
const Component = (
  definition as { component: React.ComponentType<{ element: unknown }> }
).component;

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
  const props = (node as React.ReactElement).props as Record<string, unknown> | undefined;
  if (!props) return null;
  if (typeof props[name] === "function") return props[name] as T;
  if (props.children !== undefined) return findProp<T>(props.children, name);
  return null;
}

function render(props: Record<string, unknown> = {}) {
  return (Component as unknown as (p: { element: unknown }) => unknown)({
    element: { type: "task-board", props, children: [] },
  });
}

beforeEach(() => {
  navigate.mockClear();
  host = { navigate };
});

describe("task-board click-through — generic host navigate seam (surfaces.md §11)", () => {
  it("a task-row open interpolates the default taskHref and calls host.navigate", () => {
    const onOpenTask = findProp<(id: string) => void>(render(), "onOpenTask");
    expect(onOpenTask).toBeTypeOf("function");
    onOpenTask!("task-42");
    expect(navigate).toHaveBeenCalledWith("/tasks/task-42");
  });

  it("honors a custom taskHref template", () => {
    const onOpenTask = findProp<(id: string) => void>(
      render({ taskHref: "/t/:taskId/view" }),
      "onOpenTask",
    );
    onOpenTask!("abc");
    expect(navigate).toHaveBeenCalledWith("/t/abc/view");
  });

  it("a board-link open interpolates boardHref with project + stem", () => {
    const onOpenBoard = findProp<(p: string, s: string) => void>(render(), "onOpenBoard");
    expect(onOpenBoard).toBeTypeOf("function");
    onOpenBoard!("demo", "sales_dashboard");
    expect(navigate).toHaveBeenCalledWith("/projects/demo/widget/sales_dashboard");
  });

  it("is inert when the host provides no navigate (off-app surfaces)", () => {
    host = null; // useContext → null → useOpenfusedHost() returns {} → navigate undefined
    const onOpenTask = findProp<(id: string) => void>(render(), "onOpenTask");
    // No handler is passed to the view → the rows render their inert (non-linking)
    // variant, and nothing navigates.
    expect(onOpenTask).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
