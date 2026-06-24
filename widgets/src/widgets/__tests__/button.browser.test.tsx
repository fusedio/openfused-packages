// button.browser.test.tsx — behaviour guard for the action button's two press
// channels, run in a real (headless) Chromium via Playwright
// (vitest.browser.config.ts). A node tree-walk can't prove a real DOM click
// fires the right handlers, so this mounts the button and clicks it for real.
//
// The SDK's `useUdfExecutor` is the boundary (it is unit-tested in the SDK
// package): we mock it to a controllable spy and assert the BUTTON's wiring —
//   • `executor` set  → a press calls `fire()` once;
//   • `action`  set   → a press reports to the host `ActionSinkContext`;
//   • both / neither / submit / running / error — the combinations.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";
import { ActionSinkContext, type ActionSink } from "../../action-sink";

// The executor hook state the mocked `useUdfExecutor` reflects into the button.
const execState = {
  lastExecutor: undefined as string | null | undefined,
  fire: vi.fn(),
  isRunning: false,
  error: null as string | null,
};

vi.mock("@fusedio/widget-sdk", () => ({
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
  // Mirror the real hook's surface; `canFire` is true iff the executor string is
  // non-empty (the real `parseExecutor` rule), and we record the arg so a test
  // can assert the button passed `props.executor` through verbatim.
  useUdfExecutor: (executor?: string | null) => {
    execState.lastExecutor = executor;
    return {
      fire: execState.fire,
      status: execState.isRunning ? "running" : "idle",
      isRunning: execState.isRunning,
      data: null,
      error: execState.error,
      canFire: typeof executor === "string" && executor.trim().length > 0,
      reset: () => {},
    };
  },
}));

// Import AFTER the mock so the component closes over the stubbed SDK.
const { default: definition } = await import("../button");

type Def = { component: React.ComponentType<{ element: unknown }> };

let host: HTMLElement;
let root: Root | null = null;

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  execState.lastExecutor = undefined;
  execState.fire = vi.fn();
  execState.isRunning = false;
  execState.error = null;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

function mount(props: Record<string, unknown>, sink: ActionSink | null = null): void {
  const Component = (definition as unknown as Def).component;
  root = createRoot(host);
  // flushSync commits the initial render synchronously, so the button DOM + the
  // mocked hook's recorded args are observable immediately (no cold-start race).
  flushSync(() => {
    root!.render(
      React.createElement(
        ActionSinkContext.Provider,
        { value: sink },
        React.createElement(Component, { element: { type: "button", props, children: [] } }),
      ),
    );
  });
}

function btn(): HTMLButtonElement {
  const el = host.querySelector("button");
  if (!el) throw new Error("no button rendered");
  return el;
}

describe("button executor channel", () => {
  it("passes props.executor to the hook and fires it once on press", async () => {
    await mount({ label: "Run", executor: "my_udf?x=$a" });
    expect(execState.lastExecutor).toBe("my_udf?x=$a");
    btn().click();
    await tick();
    expect(execState.fire).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the UDF is running", async () => {
    execState.isRunning = true;
    await mount({ label: "Run", executor: "u" });
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute("aria-busy")).toBe("true");
  });

  it("surfaces an execution error via the title attribute", async () => {
    execState.error = "boom";
    await mount({ label: "Run", executor: "u" });
    expect(btn().title).toBe("boom");
  });
});

describe("button action channel (unchanged)", () => {
  it("reports the action to the sink and does NOT fire a UDF when only action is set", async () => {
    const sink = vi.fn(() => true);
    await mount({ label: "Approve", action: "approve" }, sink);
    btn().click();
    await tick();
    expect(sink).toHaveBeenCalledWith("approve", false);
    expect(execState.fire).not.toHaveBeenCalled();
  });

  it("a submit press locks the button when the sink accepts", async () => {
    const sink = vi.fn(async () => true);
    await mount({ label: "Done", action: "done", submit: true }, sink);
    btn().click();
    await tick();
    expect(sink).toHaveBeenCalledWith("done", true);
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toContain("✓");
  });
});

describe("button both / neither", () => {
  it("runs the UDF AND reports the action when both are set", async () => {
    const sink = vi.fn(() => true);
    await mount({ label: "Go", executor: "u", action: "go" }, sink);
    btn().click();
    await tick();
    expect(execState.fire).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("go", false);
  });

  it("is inert (no fire, no throw) when neither executor nor action is set", async () => {
    await mount({ label: "Nothing" });
    btn().click();
    await tick();
    expect(execState.fire).not.toHaveBeenCalled();
    expect(btn().disabled).toBe(false);
  });
});
