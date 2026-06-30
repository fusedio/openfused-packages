// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import { isInteractiveTarget } from "../canvas-node";

/**
 * The node peek-drawer opens on a node click, EXCEPT when the click lands on an
 * interactive control (which should drive that control instead). The compact
 * name-link `<a>` is intentionally NOT exempt — we intercept it to peek.
 */
describe("isInteractiveTarget", () => {
  it("treats a button (or a child of one) as interactive", () => {
    const btn = document.createElement("button");
    const label = document.createElement("span");
    btn.appendChild(label);
    expect(isInteractiveTarget(btn)).toBe(true);
    expect(isInteractiveTarget(label)).toBe(true);
  });

  it("treats inputs / selects / textareas as interactive", () => {
    expect(isInteractiveTarget(document.createElement("input"))).toBe(true);
    expect(isInteractiveTarget(document.createElement("select"))).toBe(true);
    expect(isInteractiveTarget(document.createElement("textarea"))).toBe(true);
  });

  it("treats a role=button element as interactive", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    expect(isInteractiveTarget(el)).toBe(true);
  });

  it("does NOT exempt a plain element — the node peek should fire", () => {
    expect(isInteractiveTarget(document.createElement("div"))).toBe(false);
    expect(isInteractiveTarget(document.createElement("span"))).toBe(false);
  });

  it("does NOT exempt the compact name-link anchor (we intercept it to peek)", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "/projects/p/udf/foo");
    expect(isInteractiveTarget(a)).toBe(false);
  });

  it("returns false for a null / non-element target", () => {
    expect(isInteractiveTarget(null)).toBe(false);
  });
});
