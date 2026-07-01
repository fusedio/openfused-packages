// widget-import-allowlist.mjs — the CANONICAL frozen-bundle import allowlist.
//
// ── SINGLE SOURCE OF TRUTH ───────────────────────────────────────────────────
// The render surface lives in THIS repo, so the rule describing what a widget
// module may import lives here too. Both enforcers read these lists — there is
// no second copy to keep in sync:
//
//   • this package's CI guard  — scripts/check-widget-imports.mjs (every PR here)
//   • fused/static-ui/build.mjs — the esbuild `widget-import-guard` that builds the
//     deployed serve plane's frozen `widget.html`; it imports THIS file from the
//     `packages` submodule (`../packages/widgets/scripts/widget-import-allowlist.mjs`)
//     instead of redefining the lists.
//
// ── WHY THE GUARD EXISTS ─────────────────────────────────────────────────────
// The deployed serve plane serves a widget as ONE frozen, self-contained
// `widget.html` (its Lambda has no Node, bundler, or CDN). Everything a
// `src/widgets/*` module imports gets inlined into that public bundle, so the
// guard admits only the entries below — a widget can never silently drag an
// arbitrary or heavy dependency into the bundle. A new dependency is a deliberate,
// bounded addition HERE (and nowhere else).

// Bare npm packages a widget module may import. `react`/`recharts`/etc. plus the
// bounded per-widget runtime deps — each a deliberate, named entry, NOT dumb-UI
// (those route through @kit instead):
//   • @xyflow/react — the canvas widget's ReactFlow graph
//   • @dnd-kit/*    — task-board's drag-and-drop (sortable columns/cards)
// `@kit` / `@kit/*` (the ui-kit dumb-UI library) is always allowed and is NOT
// listed here — it is handled explicitly by each enforcer. Icons come from @kit,
// never `lucide-react` directly.
export const WIDGET_PKG_ALLOWLIST = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "react-markdown",
  "recharts",
  "zod",
  "@fusedio/widget-sdk",
  "@xyflow/react",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
];

// Shared render-surface modules one level up (`../x`) a widget module may reach.
// A `../` import is allowed iff the path after `../` equals or starts with one of
// these. Entries ending in `/` match a subtree; bare entries match that module.
export const KNOWN_PARENT_PREFIXES = [
  "static-bridge",
  "data-store",
  "render",
  // Ref-counted loading bus (LoadingBusContext) extracted from render.tsx to break
  // the render → registry → form → render import cycle; form.tsx subscribes to it.
  "loading-bus",
  "css",
  "session",
  "parley",
  "action-sink",
  "components/",
  // The canvas widget's React layer (renderer, node, edge, folder, chrome,
  // runtime, pure modules + canvas.css) lives one level up in src/canvas/.
  "canvas/",
  // Thin widget wrappers over shared render-surface siblings:
  //   diff.tsx → ../diff-view, markdown.tsx → ../markdown-view
  "diff-view",
  "markdown-view",
];

// Map widgets are aliased to `_map-placeholder` by build.mjs BEFORE the guard
// runs (MapLibre/deck.gl + external tiles break the self-contained-bundle
// invariant), so the real modules — and their `../maps/*` renderer imports — never
// enter the bundle and are not policed. Both enforcers skip these. (Do NOT instead
// allow `../maps/`: that would let a NON-map widget break the bundle.)
export const MAP_PLACEHOLDER_MODULES = ["map", "map-bounds", "map-h3", "fused-map"];
