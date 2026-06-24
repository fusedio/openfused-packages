// map-frame-height.browser.test.tsx — the "real tier" guard for the map widgets'
// height contract, run in a real (headless) Chromium via Playwright
// (vitest.browser.config.ts).
//
// THE BUG (recurring across dashboards): the `fused-map` / `map` widgets rendered
// BLANK because their `.ofw-map__frame` container collapsed to 0px height. The
// renderer forwards the author `style` onto the inner frame, and a natural
// `height: 100%` (what an agent writes to fill a card) resolves to 0 against an
// AUTO-height ancestor (`.ofw-fmap` / `.ofw-map` impose no height). MapLibre then
// draws into a 0-height box → nothing visible. Agents kept hand-patching each
// dashboard with explicit `height: 420px` wrappers.
//
// THE FIX: a default height FLOOR lives in widget.css as `min-height` on
// `.ofw-map__frame` (360px; 420px under `.ofw-fmap`). `min-height` (not `height`)
// is the point — it survives the `height: 100%` → 0 collapse, yet still lets a
// parent that DOES pin a height grow the map past the floor, and an author's
// explicit `height`/`min-height` (spread inline, higher specificity) still wins.
//
// This cannot be caught in jsdom — there is no layout engine and
// getBoundingClientRect is always 0, so the very condition that broke does not
// exist. We mount the EXACT frame markup the renderers emit (`.ofw-fmap >
// .ofw-map__frame`, `.ofw-map > .ofw-map__frame`) with the REAL widget.css and
// the same inline `wrapperStyle`, in a CONTENT-SIZED host (no ancestor pins a
// height — the app's single-widget page), and assert the frame paints non-zero.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// The real widget stylesheet under test — Vite injects it into the browser page,
// so the `.ofw-map__frame` min-height contract is exercised exactly as shipped.
import "../../widget.css";

let host: HTMLElement;

// The inline wrapperStyle the renderers apply BEFORE spreading author style.
// Mirrors maps/{map,fused-map,map-bounds}-renderer.tsx — no fixed pixel height;
// `height: 100%` fills an explicit-height parent, CSS min-height is the floor.
const baseFrameStyle = "position:relative;width:100%;height:100%;overflow:hidden;border-radius:8px;";

function frameHtml(outerClass: "ofw-fmap" | "ofw-map", inlineStyle: string): string {
  return `<div class="${outerClass}"><div class="ofw-map__frame" style="${inlineStyle}"></div></div>`;
}

function frame(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".ofw-map__frame");
  if (!el) throw new Error("no .ofw-map__frame");
  return el;
}

beforeEach(() => {
  // A CONTENT-SIZED host: imposes NO height, mirroring the app's single-widget
  // page where no ancestor pins a height. This is the exact condition that made
  // the `height: 100%` chain collapse to 0; a fixed-height host would mask it.
  document.body.innerHTML = "";
  host = document.createElement("div");
  host.style.width = "640px"; // a definite WIDTH only
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe("map widgets render with a default height in a content-sized container", () => {
  it("fused-map frame: paints ~420px floor with no author height", () => {
    host.innerHTML = frameHtml("ofw-fmap", baseFrameStyle);
    expect(frame().getBoundingClientRect().height).toBeGreaterThanOrEqual(420);
  });

  it("map frame: paints ~360px floor with no author height", () => {
    host.innerHTML = frameHtml("ofw-map", baseFrameStyle);
    const h = frame().getBoundingClientRect().height;
    expect(h).toBeGreaterThanOrEqual(360);
    expect(h).toBeLessThan(420); // proves the .ofw-fmap-only 420 floor doesn't bleed in
  });

  it("does NOT collapse when the author passes height:100% against an auto-height parent (the bug)", () => {
    // The classic break: author style forwards `height:100%` onto the frame.
    host.innerHTML = frameHtml("ofw-fmap", baseFrameStyle + "height:100%;");
    expect(frame().getBoundingClientRect().height).toBeGreaterThanOrEqual(420);
  });
});

describe("author overrides still win", () => {
  it("an explicit author height GROWS the frame past the floor", () => {
    host.innerHTML = frameHtml("ofw-fmap", baseFrameStyle + "height:700px;");
    // ~700 (+2px for the frame's 1px top/bottom border under content-box).
    const h = frame().getBoundingClientRect().height;
    expect(h).toBeGreaterThanOrEqual(700);
    expect(h).toBeLessThan(710);
  });

  it("an explicit author min-height below the floor is overridden by the CSS floor; above it wins", () => {
    // Author min-height ABOVE the floor wins (inline beats class specificity).
    host.innerHTML = frameHtml("ofw-map", baseFrameStyle + "height:auto;min-height:600px;");
    expect(frame().getBoundingClientRect().height).toBeGreaterThanOrEqual(600);
  });
});

describe("a wrapper that pins an explicit height grows the map (canvas card — no regression)", () => {
  it("the frame's height:100% fills a definite-height WRAPPER past the floor", () => {
    // When the immediate `.ofw-fmap` wrapper is given a definite height (a canvas
    // card pinning its node), the frame's `height: 100%` fills it past the floor —
    // the min-height does NOT cap growth. Proves we didn't regress canvas sizing.
    host.innerHTML = frameHtml("ofw-fmap", baseFrameStyle);
    const wrapper = host.querySelector<HTMLElement>(".ofw-fmap")!;
    wrapper.style.height = "800px";
    // ~800 (+2px for the frame's 1px top/bottom border under content-box) — well
    // past the 420 floor, proving min-height does not cap an explicit-height parent.
    const h = frame().getBoundingClientRect().height;
    expect(h).toBeGreaterThanOrEqual(800);
    expect(h).toBeLessThan(810);
  });
});
