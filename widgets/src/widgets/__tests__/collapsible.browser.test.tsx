// collapsible.browser.test.tsx — behaviour guard for the disclosure container,
// in a real (headless) Chromium via Playwright. The open/close toggle runs over
// the @kit Collapsible (Radix) primitive, which unmounts its content when closed
// — a real-DOM concern a tree-walk can't see. We assert:
//   • closed by default → the child detail is NOT in the DOM;
//   • clicking the summary trigger reveals the child;
//   • defaultOpen renders expanded from the start;
//   • it writes no param.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";

vi.mock("@fusedio/widget-sdk", () => ({
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

const { default: definition } = await import("../collapsible");

type Def = { component: React.ComponentType<{ element: unknown }> };

let host: HTMLElement;
let root: Root | null = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
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
        element: {
          type: "collapsible",
          props,
          children: [React.createElement("div", { key: "d" }, "SECRET_DETAIL")],
        },
      }),
    );
  });
  await tick();
}

const trigger = () => host.querySelector("button") as HTMLButtonElement | null;

describe("collapsible", () => {
  it("is closed by default: the summary shows but the detail is hidden", async () => {
    await mount({ summary: "Full spec" });
    expect(host.textContent).toContain("Full spec");
    expect(host.textContent).not.toContain("SECRET_DETAIL");
  });

  it("clicking the summary reveals the detail", async () => {
    await mount({ summary: "Full spec" });
    trigger()!.click();
    await tick();
    expect(host.textContent).toContain("SECRET_DETAIL");
  });

  it("defaultOpen renders expanded from the start", async () => {
    await mount({ summary: "Full spec", defaultOpen: true });
    expect(host.textContent).toContain("SECRET_DETAIL");
  });

  it("writes no param", () => {
    expect((definition as unknown as { writesParam: boolean }).writesParam).toBe(false);
  });
});
