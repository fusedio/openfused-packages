import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const uiKitSrc = fileURLToPath(new URL("../ui-kit/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror build.mjs / tsconfig: compose the shared ui-kit by source path.
      // The longer "@kit/" form must precede the bare "@kit" so subpaths
      // (e.g. @kit/index.css) match first.
      "@kit/": `${uiKitSrc}/`,
      "@kit": `${uiKitSrc}/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["src/*.test.ts", "src/canvas/**/*.test.ts", "src/widgets/**/*.test.{ts,tsx}"],
    // The real-browser tier runs under vitest.browser.config.ts (a real Chromium
    // via Playwright); keep its `*.browser.test.tsx` files out of this fast,
    // layout-free node run, which would crash on recharts' DOM measurement.
    exclude: ["**/*.browser.test.tsx", "**/node_modules/**"],
  },
});
