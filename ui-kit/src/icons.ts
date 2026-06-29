// @fusedio/ui-kit — icon re-export surface.
//
// Widget render modules (packages/widgets/src/widgets/*) MUST NOT import npm
// packages directly: the deployed serve plane bundles them into the frozen,
// self-contained widget.html, and the static-ui `widget-import-guard`
// (fused/static-ui/build.mjs) errors the build if a `src/widgets/*` module
// imports anything outside its allowlist (react, recharts, @fusedio/widget-sdk,
// `@kit`/`@kit/*`, relative siblings). So a widget that needs an icon composes
// it through the `@kit` barrel rather than reaching for `lucide-react` itself.
//
// lucide-react is already a transitive ui-kit dependency (its primitives use it
// internally), so re-exporting icons here adds NO new dependency — esbuild
// tree-shakes the bundle down to only the icons actually referenced.
//
// This is a CURATED surface on purpose: the frozen public widget.html bundle
// should expose an intentional icon set, not the whole library. A widget that
// needs an icon not listed here adds one line below (keep alphabetical) — the
// import guard will point here with a clear error if it imports lucide directly.
export {
  AppWindow,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  Folder,
  Hourglass,
  KeyRound,
  Layers,
  Loader2,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
export type { LucideIcon } from "lucide-react";
