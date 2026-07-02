// ui-kit's @testing-library/jest-dom matcher augmentation of vitest's `Assertion`
// interface so `toHaveAttribute`/`toBeInTheDocument`/etc. typecheck in the
// component tests (src/**/*.test.tsx, e.g. button.test.tsx). The runtime matcher
// registration is installed by the vitest setup that runs these tests; this file
// only carries the types for `tsc` (which includes src via tsconfig.json). Mirrors
// widget-host/src/ui/vitest-jest-dom.d.ts.
import "@testing-library/jest-dom/vitest";
