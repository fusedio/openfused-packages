import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const uiKitSrc = fileURLToPath(new URL("../ui-kit/src", import.meta.url));

// Browser-mode ("real tier") config — the companion to the cheap jsdom-free node
// tests in vitest.config.ts. The chart widgets' height-collapse class of bug
// (recharts' ResponsiveContainer measuring a content-sized card as 0px; PR #123
// Bug B) is a LAYOUT/geometry regression: it only exists where a real layout
// engine resolves the percentage-height chain. jsdom has no layout
// (getBoundingClientRect is always 0), so the very condition that broke cannot be
// reproduced there. These tests therefore run in a real (headless) Chromium via
// Playwright, load the real widget.css, and assert the chart actually paints with
// a non-zero height.
//
// Kept in a SEPARATE config + file glob (`*.browser.test.tsx`) so the default
// `pnpm test` (node, no browser download) stays fast and dependency-free; the
// browser tier runs under `pnpm test:browser` and its own CI job.
export default defineConfig({
  resolve: {
    alias: {
      "@kit/": `${uiKitSrc}/`,
      "@kit": `${uiKitSrc}/index.ts`,
    },
  },
  // Pre-bundle every dep the test + chart components pull in. On a COLD cache
  // (CI, where there is no `.vite`), Vite otherwise discovers some of these
  // mid-run (notably `react/jsx-dev-runtime`) and re-optimizes, which forces a
  // page reload. The reload re-evaluates modules and leaves a SECOND copy of
  // React live alongside recharts' pending async work → "Invalid hook call /
  // multiple copies of React" and null-dispatcher crashes. Declaring them here
  // means there is no mid-run discovery, so no reload. (Warm local caches hid
  // this; CI's cold cache surfaced it.)
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "react-is",
      "recharts",
    ],
  },
  test: {
    include: ["src/widgets/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // One Chromium instance — a real layout engine is all Bug B needs; we are
      // not chasing cross-browser rendering differences here.
      instances: [{ browser: "chromium" }],
    },
  },
});
