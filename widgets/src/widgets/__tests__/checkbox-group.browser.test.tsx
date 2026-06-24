// checkbox-group.browser.test.tsx — behaviour guard for the multi-select
// checkbox group, run in a real (headless) Chromium via Playwright
// (vitest.browser.config.ts). The toggle / seeding / max-disable logic is real
// DOM interaction over the @kit Checkbox + Label primitives, which a node
// tree-walk can't exercise — so this mounts the group and clicks it for real.
//
// The SDK is the boundary (unit-tested in its own package): we mock it to a
// controllable, REACTIVE param store (`useFusedParam` backed by real React
// state so a click re-renders the checked rows) and assert the GROUP's wiring —
//   • static options → N rows; ticking appends the value as an ARRAY;
//   • un-ticking removes it, preserving the order of the rest;
//   • `defaultSelected` seeds on mount iff no canvas value exists;
//   • `maxSelected` reached → unticked rows disabled (ticked stay enabled);
//   • bounds → helper text; sql precedence + fallback; self-reference guard;
//   • loading → rows disabled + "Loading options…".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";

// Shared, mutable SDK state the mock reflects into the component. `vi.hoisted`
// makes it reachable from both the (hoisted) mock factory and the tests.
const sdk = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  loading: false,
  error: null as string | null,
  sqlParams: [] as string[],
  // Mount-time canvas value: undefined → param untouched (seeds [] default).
  initial: undefined as unknown,
  setValue: undefined as undefined | ((v: unknown) => void),
}));

vi.mock("@fusedio/widget-sdk", async () => {
  const ReactMod = await import("react");
  return {
    parseStyle: () => ({}),
    defineComponent: (def: unknown) => def,
    extractSqlParams: () => sdk.sqlParams,
    useDuckDbSqlQuery: () => ({
      rows: sdk.rows,
      columns: [] as string[],
      loading: sdk.loading,
      error: sdk.error,
      refetch: () => {},
    }),
    // Reactive param store: real React state seeded from `sdk.initial` (or the
    // component's `defaultValue`), and a `setValue` that records via the spy AND
    // updates the state so the rendered checkboxes track the selection.
    useFusedParam: ({ defaultValue }: { defaultValue: unknown }) => {
      const [v, setV] = ReactMod.useState(
        sdk.initial !== undefined ? sdk.initial : defaultValue,
      );
      const setValue = ReactMod.useCallback((nv: unknown) => {
        sdk.setValue?.(nv);
        setV(nv);
      }, []);
      return { value: v, setValue, broadcastNow() {}, clearValue() {} };
    },
  };
});

// Import AFTER the mock so the component closes over the stubbed SDK.
const { default: definition } = await import("../checkbox-group");

type Def = { component: React.ComponentType<{ element: unknown }> };

let host: HTMLElement;
let root: Root | null = null;

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sdk.rows = [];
  sdk.loading = false;
  sdk.error = null;
  sdk.sqlParams = [];
  sdk.initial = undefined;
  sdk.setValue = vi.fn();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

async function mount(props: Record<string, unknown>): Promise<void> {
  const Component = (definition as unknown as Def).component;
  root = createRoot(host);
  flushSync(() => {
    root!.render(
      React.createElement(Component, {
        element: { type: "checkbox-group", props, children: [] },
      }),
    );
  });
  // Let the mount-only defaultSelected-seeding effect run.
  await tick();
}

function boxes(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('[role="checkbox"]')) as HTMLButtonElement[];
}
function isChecked(b: HTMLButtonElement): boolean {
  return b.getAttribute("aria-checked") === "true";
}
function labels(): string[] {
  return Array.from(host.querySelectorAll('[data-slot="label"]')).map(
    (el) => el.textContent ?? "",
  );
}

describe("checkbox-group — static options + array write", () => {
  it("renders one row per option and ticking appends the value as an array", async () => {
    await mount({
      param: "picks",
      options: [
        { value: "a", label: "Apple" },
        { value: "b", label: "Banana" },
      ],
    });
    expect(boxes()).toHaveLength(2);
    expect(labels()).toEqual(["Apple", "Banana"]);
    // Nothing seeded on mount (no defaultSelected): the param stays untouched.
    expect(sdk.setValue).not.toHaveBeenCalled();

    boxes()[1].click();
    await tick();
    expect(sdk.setValue).toHaveBeenLastCalledWith(["b"]);
    expect(isChecked(boxes()[1])).toBe(true);

    boxes()[0].click();
    await tick();
    // preserve-on-toggle: append → ["b", "a"].
    expect(sdk.setValue).toHaveBeenLastCalledWith(["b", "a"]);
  });

  it("un-ticking removes the value, preserving the order of the rest", async () => {
    sdk.initial = ["a", "b", "c"];
    await mount({
      param: "picks",
      options: [
        { value: "a" },
        { value: "b" },
        { value: "c" },
      ],
    });
    // pre-checked from the canvas value, no seed.
    expect(sdk.setValue).not.toHaveBeenCalled();
    expect(boxes().map(isChecked)).toEqual([true, true, true]);

    boxes()[1].click(); // un-tick "b"
    await tick();
    expect(sdk.setValue).toHaveBeenLastCalledWith(["a", "c"]);
  });
});

describe("checkbox-group — defaultSelected seeding", () => {
  it("seeds the param on mount when no canvas value exists", async () => {
    await mount({
      param: "picks",
      options: [{ value: "a" }, { value: "b" }],
      defaultSelected: ["a"],
    });
    expect(sdk.setValue).toHaveBeenCalledTimes(1);
    expect(sdk.setValue).toHaveBeenCalledWith(["a"]);
    expect(boxes().map(isChecked)).toEqual([true, false]);
  });

  it("does NOT seed when a canvas value already exists", async () => {
    sdk.initial = ["b"];
    await mount({
      param: "picks",
      options: [{ value: "a" }, { value: "b" }],
      defaultSelected: ["a"],
    });
    expect(sdk.setValue).not.toHaveBeenCalled();
    expect(boxes().map(isChecked)).toEqual([false, true]);
  });
});

describe("checkbox-group — bounds", () => {
  it("renders helper text for a min/max range", async () => {
    await mount({
      param: "picks",
      options: [{ value: "a" }, { value: "b" }, { value: "c" }],
      minSelected: 1,
      maxSelected: 3,
    });
    expect(host.textContent).toContain("Select 1–3");
  });

  it("disables unticked rows once maxSelected is reached; ticked rows stay enabled", async () => {
    sdk.initial = ["a"];
    await mount({
      param: "picks",
      options: [{ value: "a" }, { value: "b" }, { value: "c" }],
      maxSelected: 1,
    });
    const [a, b, c] = boxes();
    expect(a.disabled).toBe(false); // ticked → still toggleable (can un-tick)
    expect(b.disabled).toBe(true); // unticked + at max → disabled
    expect(c.disabled).toBe(true);

    // Clicking a disabled unticked row is inert.
    b.click();
    await tick();
    expect(sdk.setValue).not.toHaveBeenCalled();
  });
});

describe("checkbox-group — sql option resolution", () => {
  it("uses sql rows (named value/label) when present", async () => {
    sdk.rows = [
      { value: "x", label: "Ex" },
      { VALUE: "y", LABEL: "Why" },
    ];
    await mount({ param: "picks", sql: "select value, label from t" });
    expect(labels()).toEqual(["Ex", "Why"]);
  });

  it("falls back to static options on sql error", async () => {
    sdk.error = "boom";
    await mount({
      param: "picks",
      sql: "select 1",
      options: [{ value: "a", label: "Apple" }],
    });
    expect(labels()).toEqual(["Apple"]);
  });

  it("does not run the query when sql references its own param (self-reference guard)", async () => {
    sdk.sqlParams = ["picks"];
    sdk.rows = [{ value: "x", label: "FromSql" }];
    await mount({
      param: "picks",
      sql: "select * from t where v = $picks",
      options: [{ value: "a", label: "Static" }],
    });
    // guard disables the query → static options win even though rows exist.
    expect(labels()).toEqual(["Static"]);
  });

  it("disables rows and shows a loading indicator while sql loads", async () => {
    sdk.loading = true;
    sdk.rows = [];
    await mount({
      param: "picks",
      sql: "select 1",
      options: [{ value: "a", label: "Apple" }],
    });
    expect(host.textContent).toContain("Loading options…");
    expect(boxes().every((b) => b.disabled)).toBe(true);
  });
});
