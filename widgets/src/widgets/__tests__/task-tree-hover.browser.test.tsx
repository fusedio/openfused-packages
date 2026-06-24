// task-tree-hover.browser.test.tsx — guard for the tree-view hover highlight.
//
// Regression: hovering ONE tree row used to also tint its blockers/dependents,
// so the hover read as if it highlighted several rows at once. The fix: hover/
// focus tints ONLY the pointed-at row — related blockers/dependents are surfaced
// by the "waiting on" badge, never by tinting other rows (spec/app-task-tree.md §2).
//
// Runs in a real (headless) Chromium via vitest.browser.config.ts so React hover
// state actually transitions — the node-mocked unit test (task-board.test.tsx)
// pins useState to its initial and can't exercise this.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";

// The SDK is the boundary; TaskBoardView doesn't query through it for the tree
// render (it takes `tasks` directly), but the module imports the hooks at top
// level, so stub them to inert identities.
vi.mock("@fusedio/widget-sdk", () => ({
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
  extractSqlParams: () => [] as string[],
  useDuckDbSqlQuery: () => ({ rows: [], columns: [], loading: false, error: null, refetch() {} }),
  useFusedWidgetBridge: () => ({
    params: { set() {} },
    udfs: { execute: async () => ({ data: { ok: true }, error: null }) },
  }),
  useFusedParam: ({ defaultValue }: { defaultValue: unknown }) => ({
    value: defaultValue,
    setValue() {},
    broadcastNow() {},
    clearValue() {},
  }),
}));

const { TaskBoardView } = await import("../task-board");
import type { Task } from "../task-board-shared";

function makeTask(over: Partial<Task> & Pick<Task, "id" | "number">): Task {
  return {
    project: "p",
    title: `Task ${over.number}`,
    description: "",
    status: "in_progress",
    agentId: null,
    createdBy: "human",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    parentId: null,
    blockedBy: [],
    runs: [],
    isLive: false,
    liveRunCount: 0,
    ...over,
  } as Task;
}

let host: HTMLElement;
let root: Root | null = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  // useViewState persists per-project to localStorage — clear so each test starts
  // on the supplied defaultView ("tree").
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

async function mount(tasks: Task[]): Promise<void> {
  root = createRoot(host);
  flushSync(() => {
    root!.render(
      React.createElement(TaskBoardView, {
        tasks,
        loading: false,
        project: "p",
        defaultView: "tree" as const,
        defaultGroupBy: "status" as const,
        onOpenTask: () => {},
      }),
    );
  });
  await tick();
}

/** The tree row divs (role=button, set when onOpenTask is wired). */
function rows(): HTMLElement[] {
  return Array.from(host.querySelectorAll('div[role="button"]')) as HTMLElement[];
}
/** The row whose OWN TASK-NN label matches the given number. Matches the row's
 * leading mono label span (font-mono text-xs), NOT any "Waiting on TASK-NN" badge
 * text elsewhere in the row — otherwise a blocker's number would resolve to the
 * blocked row that mentions it. */
function rowFor(num: number): HTMLElement {
  const label = `TASK-${String(num).padStart(2, "0")}`;
  const row = rows().find((r) => {
    const own = r.querySelector("span.font-mono.text-xs");
    return own?.textContent?.trim() === label;
  });
  if (!row) throw new Error(`no tree row for ${label}`);
  return row;
}
// Drive a REAL pointer hover through Playwright so React's onMouseEnter (which it
// synthesizes from native pointer crossings, not a bare dispatch) actually fires.
async function hover(el: HTMLElement): Promise<void> {
  await userEvent.hover(el);
  await tick();
}
const hasAccentFill = (el: HTMLElement) =>
  Array.from(el.classList).some((c) => c.startsWith("bg-accent"));
const hasBlockerRail = (el: HTMLElement) =>
  Array.from(el.classList).some((c) => c.startsWith("bg-amber-400") || c.startsWith("shadow-"));

describe("task tree — hover highlights only the hovered row", () => {
  it("hovering a row fills only that row; neither its blocker nor unrelated rows react", async () => {
    // A is blocked by B (A.blockedBy = [B]); C is unrelated. Hovering A fills ONLY
    // A — the blocker B and the unrelated C get no tint of any kind (the blocker
    // relationship is shown by the "waiting on" badge, not by tinting B's row).
    const a = makeTask({ id: "a", number: 1, blockedBy: ["b"] });
    const b = makeTask({ id: "b", number: 2 });
    const c = makeTask({ id: "c", number: 3 });
    await mount([a, b, c]);

    expect(rows().length).toBeGreaterThanOrEqual(3);

    await hover(rowFor(1)); // hover A

    // Exactly one row carries the accent (hover/active) fill: the hovered A.
    const filled = rows().filter(hasAccentFill);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(rowFor(1));

    // The blocker B is NOT tinted (no accent fill, no rail) — only the badge marks it.
    expect(hasAccentFill(rowFor(2))).toBe(false);
    expect(hasBlockerRail(rowFor(2))).toBe(false);

    // The unrelated C gets neither.
    expect(hasAccentFill(rowFor(3))).toBe(false);
    expect(hasBlockerRail(rowFor(3))).toBe(false);
  });

  it("hovering a plain row (no blocker edges) fills exactly one row", async () => {
    const a = makeTask({ id: "a", number: 1 });
    const b = makeTask({ id: "b", number: 2 });
    await mount([a, b]);

    await hover(rowFor(1));

    const filled = rows().filter(hasAccentFill);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(rowFor(1));
  });
});
