// render-prop-warning.browser.test.tsx — the renderer soft-warns on props the
// live bundle does not recognize.
//
// Task 1a bakes a per-type allow-set (keys of each widget's sanitized Draft-07
// propsSchema) into `generated/allowed-props.json`. render.tsx checks each KNOWN
// node's authored props against that set (minus the ALWAYS_ALLOWED exemptions
// `_queryId` / `style`) and renders a visible `.ofw-warning` [role="alert"]
// ALONGSIDE the widget — never replacing it. Unknown component TYPES keep their
// existing single `.ofw-unknown` placeholder and must NOT also get a prop-warning.
//
// Runs in real Chromium (vitest.browser.config.ts) so the DOM assertions exercise
// the shipped render path; the SDK data seam is stubbed so hooks resolve inertly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import "../../widget.css";

// Stub the SDK hooks the widgets call so a genuine render resolves synchronously.
vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => ({ rows: [], columns: [], loading: false, error: null }),
  useFusedParam: () => ({ setValue: () => {}, value: undefined }),
  useJsonUiBinding: () => ({ queryId: undefined }),
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
  FusedWidgetBridgeContext: React.createContext(null),
  JsonUiBindingContext: React.createContext({}),
}));

// Import AFTER the mock so render.tsx + the registry close over the stubbed SDK.
const { RenderNode } = await import("../../render");
import type { UINode } from "../../render";

let host: HTMLElement;
let root: Root | null = null;

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

function render(node: UINode): void {
  root = createRoot(host);
  // flushSync commits synchronously so the DOM is queryable immediately after
  // render — plain root.render() schedules asynchronously and leaves the DOM
  // empty for these queries (mirrors button.browser.test.tsx).
  flushSync(() => {
    root!.render(React.createElement(RenderNode, { node }));
  });
}

describe("renderer prop warning", () => {
  it("warns on an unrecognized prop but still renders the widget", () => {
    // `grupBy` is a typo of the real `groupBy` — not in the sql-table allow-set.
    render({ type: "sql-table", props: { sql: "select 1", grupBy: "x" } });

    const warning = host.querySelector<HTMLElement>('[role="alert"].ofw-warning');
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("grupBy");
    expect(warning!.textContent).toContain("sql-table");

    // The widget itself still rendered (it is NOT the unknown placeholder).
    expect(host.querySelector(".ofw-unknown")).toBeNull();
    // Something beyond the warning div was rendered under the node marker.
    const marker = host.querySelector("[data-ofw-node]");
    expect(marker).not.toBeNull();
    expect(marker!.childElementCount).toBeGreaterThan(1);
  });

  it("does not warn when the only extras are _queryId and style", () => {
    render({
      type: "sql-table",
      props: { sql: "select 1", _queryId: "q1", style: "color: red" },
    });
    expect(host.querySelector(".ofw-warning")).toBeNull();
  });

  it("renders exactly the unknown placeholder (no prop-warning) for an unknown type", () => {
    render({ type: "not-a-real-widget", props: { grupBy: "x" } });
    expect(host.querySelectorAll(".ofw-unknown")).toHaveLength(1);
    expect(host.querySelector(".ofw-warning")).toBeNull();
  });

  it("does not warn on arbitrary props of a passthrough container type (div)", () => {
    // `div` declares no own props (only universal `style`) and is a raw-HTML
    // passthrough container — author-supplied documentation labels like
    // `title`/`description` must not trigger the advisory.
    render({ type: "div", props: { title: "x", description: "y" } });
    expect(host.querySelector(".ofw-warning")).toBeNull();
    // The div still renders (it is NOT the unknown placeholder).
    expect(host.querySelector(".ofw-unknown")).toBeNull();
  });
});
