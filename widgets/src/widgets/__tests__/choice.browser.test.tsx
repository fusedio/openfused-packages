// choice.browser.test.tsx — behaviour guard for the single/multi choice widget
// with the "Other" escape hatch, in a real (headless) Chromium via Playwright.
// The reveal + param-write logic is real DOM interaction over the @kit
// RadioCardGroup / Checkbox / Input primitives, which a tree-walk can't exercise.
//
// The SDK is the boundary: we mock it to controllable, REACTIVE param stores —
// `useFusedParamWithForm` (scalar, single mode) and `useFusedParam` (array, multi
// mode) — each backed by real React state so a click/type re-renders, and assert:
//   • single: N radios (+ "Other"); picking writes the value; picking "Other"
//     reveals an input and typing writes the typed text;
//   • multiple: N checkboxes (+ "Other"); ticking appends the value as an ARRAY;
//     "Other" reveals an input and typing appends the typed text.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";

const sdk = vi.hoisted(() => ({
  scalar: undefined as unknown, // mount-time canvas value for single mode
  array: undefined as unknown, // mount-time canvas value for multi mode
  setScalar: undefined as undefined | ((v: unknown) => void),
  setArray: undefined as undefined | ((v: unknown) => void),
}));

vi.mock("@fusedio/widget-sdk", async () => {
  const R = await import("react");
  return {
    parseStyle: () => ({}),
    defineComponent: (def: unknown) => def,
    useFusedParamWithForm: ({ defaultValue }: { defaultValue: unknown }) => {
      const [v, setV] = R.useState(sdk.scalar !== undefined ? sdk.scalar : defaultValue);
      const setValue = R.useCallback((nv: unknown) => {
        sdk.setScalar?.(nv);
        setV(nv);
      }, []);
      return { value: v, setValue };
    },
    useFusedParam: ({ defaultValue }: { defaultValue: unknown }) => {
      const [v, setV] = R.useState(sdk.array !== undefined ? sdk.array : defaultValue);
      const setValue = R.useCallback((nv: unknown) => {
        sdk.setArray?.(nv);
        setV(nv);
      }, []);
      return { value: v, setValue, broadcastNow() {}, clearValue() {} };
    },
  };
});

const { default: definition } = await import("../choice");

type Def = { component: React.ComponentType<{ element: unknown }> };

let host: HTMLElement;
let root: Root | null = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sdk.scalar = undefined;
  sdk.array = undefined;
  sdk.setScalar = vi.fn();
  sdk.setArray = vi.fn();
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
      React.createElement(Component, { element: { type: "choice", props, children: [] } }),
    );
  });
  await tick();
}

const radios = () => Array.from(host.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
const checks = () => Array.from(host.querySelectorAll('[role="checkbox"]')) as HTMLButtonElement[];
const input = () => host.querySelector("input") as HTMLInputElement | null;

function type(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("choice — single mode (radios) + Other reveal", () => {
  it("renders one radio per option plus Other, and picking writes the value", async () => {
    await mount({
      param: "grain",
      mode: "single",
      allowOther: true,
      options: [
        { value: "daily", label: "Daily" },
        { value: "hourly", label: "Hourly" },
      ],
    });
    expect(radios()).toHaveLength(3); // 2 options + Other
    expect(input()).toBeNull(); // Other not selected → no field

    radios()[0].click();
    await tick();
    expect(sdk.setScalar).toHaveBeenLastCalledWith("daily");
  });

  it("seeds an off-menu defaultValue into the param on mount (Other pre-filled)", async () => {
    // Regression: an off-menu default must WRITE the param, not just render the
    // Other field — else a form submit silently loses the seeded answer.
    await mount({
      param: "grain",
      mode: "single",
      allowOther: true,
      defaultValue: "fortnightly",
      options: [{ value: "daily", label: "Daily" }],
    });
    expect(sdk.setScalar).toHaveBeenCalledWith("fortnightly");
    expect(input()?.value).toBe("fortnightly");
  });

  it("selecting Other reveals a text field and typing becomes the value", async () => {
    await mount({
      param: "grain",
      mode: "single",
      allowOther: true,
      options: [{ value: "daily", label: "Daily" }],
    });
    // Other is the last radio.
    radios()[radios().length - 1].click();
    await tick();
    const field = input();
    expect(field).not.toBeNull();
    type(field!, "weekly");
    await tick();
    expect(sdk.setScalar).toHaveBeenLastCalledWith("weekly");
  });
});

describe("choice — multiple mode (checkboxes) + Other reveal", () => {
  it("ticking appends the value as an array", async () => {
    await mount({
      param: "sources",
      mode: "multiple",
      allowOther: true,
      options: [
        { value: "api", label: "API" },
        { value: "wh", label: "Warehouse" },
      ],
    });
    expect(checks()).toHaveLength(3); // 2 options + Other
    checks()[0].click();
    await tick();
    expect(sdk.setArray).toHaveBeenLastCalledWith(["api"]);
  });

  it("Other reveals a field and typing appends the typed text to the array", async () => {
    await mount({
      param: "sources",
      mode: "multiple",
      allowOther: true,
      options: [{ value: "api", label: "API" }],
    });
    checks()[0].click(); // tick API
    await tick();
    checks()[checks().length - 1].click(); // tick Other
    await tick();
    const field = input();
    expect(field).not.toBeNull();
    type(field!, "csv");
    await tick();
    expect(sdk.setArray).toHaveBeenLastCalledWith(["api", "csv"]);
  });
});

describe("choice — contract", () => {
  it("is an input (writes a param)", () => {
    expect((definition as unknown as { writesParam: boolean }).writesParam).toBe(true);
  });
});
