import { describe, it, expect } from "vitest";

import { renderCheck } from "./render-check";
import type { UINode } from "./render";

// Pins the render-check's core promise: it MOUNTS the tree (catching crashes the
// resolve path is blind to), and it distinguishes a render throw from a clean
// render. The motivating bug: the JSON-UI `style` prop is an inline CSS *string*,
// but an agent authored it as a React `CSSProperties` object, so `parseStyle`
// called `.split(";")` on a non-string and crashed the whole widget — invisible
// to `POST /api/exec/widget`, which only runs queries and never renders.

describe("renderCheck", () => {
  it("FAILS a config whose `style` is an object (the parseStyle crash)", () => {
    const config: UINode = {
      type: "div",
      // ❌ object, not a CSS string — what crashed disaster_dashboard{,_fixed}.
      props: { style: { display: "flex", gap: "16px" } as unknown as string },
      children: [{ type: "text", props: { value: "hi" } }],
    };
    const result = renderCheck(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/split is not a function/);
  });

  it("PASSES the same tree once `style` is a CSS string", () => {
    const config: UINode = {
      type: "div",
      props: { style: "display:flex;gap:16px" },
      children: [{ type: "text", props: { value: "hi" } }],
    };
    expect(renderCheck(config)).toEqual({ ok: true });
  });
});
