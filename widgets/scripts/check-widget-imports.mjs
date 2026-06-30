#!/usr/bin/env node
// check-widget-imports.mjs — enforce the frozen-bundle import allowlist on the
// widget render modules, IN THIS REPO, on every PR.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The deployed serve plane serves a widget as ONE frozen, fully self-contained
// `widget.html` (the Lambda has no Node, no bundler, no CDN at runtime). The
// `fused` repo builds that bundle from THIS package's `src/widgets/*` via esbuild,
// under a `widget-import-guard` (fused/static-ui/build.mjs) that admits only a
// fixed set of imports — so a widget module can never silently drag an arbitrary
// or heavy dependency into the public bundle.
//
// That guard lives in `fused`; nothing in THIS repo knew about it, so widget
// modules could (and did) drift out of compliance — and the breakage only
// surfaced downstream, when someone bumped the submodule and rebuilt `widget.html`.
// This script is the SOURCE-SIDE enforcement of the same rule: it fails a PR here
// with the same verdict the downstream build would give, before any submodule bump.
//
// ── Allowlist lives in widget-import-allowlist.mjs ───────────────────────────
// The lists are the CANONICAL single source of truth in this repo; fused/static-ui/
// build.mjs imports the SAME file from the packages submodule, so there is no second
// copy to keep in sync. A new widget dependency is a deliberate, bounded addition
// THERE (and nowhere else).
//
// Scope note: the build guard only ever runs on modules esbuild actually pulls into
// the bundle. Test files (`__tests__/`, `*.test.*`, `*.spec.*`) are never in that
// graph, so they are excluded here too — otherwise their `vitest` / deep relative
// imports would be false positives the real build never hits.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WIDGET_PKG_ALLOWLIST as PKG_ALLOWLIST_LIST,
  KNOWN_PARENT_PREFIXES,
  MAP_PLACEHOLDER_MODULES as MAP_PLACEHOLDER_LIST,
} from "./widget-import-allowlist.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const widgetsDir = resolve(here, "..", "src", "widgets"); // packages/widgets/src/widgets
const repoRoot = resolve(here, "..", "..");

const WIDGET_PKG_ALLOWLIST = new Set(PKG_ALLOWLIST_LIST);
const MAP_PLACEHOLDER_MODULES = new Set(MAP_PLACEHOLDER_LIST);

// ── Comment masking ──────────────────────────────────────────────────────────
// Replace comment bodies with spaces (newlines preserved, so offsets/line numbers
// stay exact) WITHOUT touching string literals — string contents must survive so
// import specifiers remain matchable. A tiny char state machine handles `//`, `/* */`,
// and the three string kinds (', ", `).
function maskComments(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const CODE = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TICK = 5;
  let state = CODE;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (state === CODE) {
      if (c === "/" && next === "/") { out[i] = " "; out[i + 1] = " "; i += 2; state = LINE; continue; }
      if (c === "/" && next === "*") { out[i] = " "; out[i + 1] = " "; i += 2; state = BLOCK; continue; }
      if (c === "'") { state = SQ; i++; continue; }
      if (c === '"') { state = DQ; i++; continue; }
      if (c === "`") { state = TICK; i++; continue; }
      i++; continue;
    }
    if (state === LINE) {
      if (c === "\n") { state = CODE; i++; continue; }
      out[i] = " "; i++; continue;
    }
    if (state === BLOCK) {
      if (c === "*" && next === "/") { out[i] = " "; out[i + 1] = " "; i += 2; state = CODE; continue; }
      if (c !== "\n") out[i] = " ";
      i++; continue;
    }
    // string states — keep chars verbatim, honor escapes
    if (c === "\\") { i += 2; continue; }
    if (state === SQ && c === "'") { state = CODE; i++; continue; }
    if (state === DQ && c === '"') { state = CODE; i++; continue; }
    if (state === TICK && c === "`") { state = CODE; i++; continue; }
    i++;
  }
  return out.join("");
}

function lineOf(src, index) {
  let line = 1;
  for (let k = 0; k < index && k < src.length; k++) if (src[k] === "\n") line++;
  return line;
}

// Extract import/require specifiers from comment-masked source.
// The `[^'"`;]*?` guard between the keyword and `from` means a `from "x"` that
// sits inside a string literal can never be reached (it would require crossing a
// quote), so SQL/text strings don't produce false positives.
function extractImports(masked) {
  const found = [];
  // lineOf uses the match END (the closing quote, always on the same line as the
  // specifier) — not match.index, which the leading `[\n;{}]` delimiter pushes
  // onto the previous line.
  const push = (spec, m, typeOnly) =>
    found.push({ spec, line: lineOf(masked, m.index + m[0].length), typeOnly });

  // import ... from "x"  /  export ... from "x"
  const fromRe = /(?:^|[\n;{}])\s*(import|export)(\b[^'"`;]*?)\bfrom\s*(['"])([^'"]+)\3/g;
  for (let m; (m = fromRe.exec(masked)); ) {
    const clause = m[2];
    // `import type ... from` / `export type ... from` are erased by esbuild and
    // never reach the build guard, so don't police them here either.
    const typeOnly = /^\s+type\b/.test(clause);
    push(m[4], m, typeOnly);
  }
  // side-effect import "x"
  const sideRe = /(?:^|[\n;{}])\s*import\s*(['"])([^'"]+)\1/g;
  for (let m; (m = sideRe.exec(masked)); ) push(m[2], m, false);
  // dynamic import("x")
  const dynRe = /\bimport\s*\(\s*(['"])([^'"]+)\1/g;
  for (let m; (m = dynRe.exec(masked)); ) push(m[2], m, false);
  // require("x")
  const reqRe = /\brequire\s*\(\s*(['"])([^'"]+)\1/g;
  for (let m; (m = reqRe.exec(masked)); ) push(m[2], m, false);

  return found;
}

// Classify a specifier against the allowlist; return a reason string if disallowed,
// or null if allowed. Mirrors build.mjs's widget-import-guard onResolve logic.
function violation(spec) {
  const relative = spec.startsWith(".");
  if (!relative && !isAbsolute(spec)) {
    if (spec === "@kit" || spec.startsWith("@kit/")) return null;
    const root = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (WIDGET_PKG_ALLOWLIST.has(spec) || WIDGET_PKG_ALLOWLIST.has(root)) return null;
    return `disallowed package "${spec}"`;
  }
  if (spec.startsWith("./") || spec === ".") return null;
  if (spec.startsWith("../")) {
    const rest = spec.slice(3);
    if (KNOWN_PARENT_PREFIXES.some((p) => rest === p || rest.startsWith(p))) return null;
    return `disallowed relative path "${spec}"`;
  }
  return `disallowed import "${spec}"`;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue; // tests are not in the bundle graph
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { yield* walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) continue; // *.test.* / *.spec.*
    if (/\.browser\.[cm]?[jt]sx?$/.test(name)) continue;
    // Map widgets are aliased out of the frozen bundle (see above) — not policed.
    if (dir === widgetsDir && MAP_PLACEHOLDER_MODULES.has(name.replace(/\.tsx?$/, ""))) continue;
    yield full;
  }
}

const problems = [];
for (const file of walk(widgetsDir)) {
  const src = readFileSync(file, "utf8");
  const imports = extractImports(maskComments(src));
  for (const { spec, line, typeOnly } of imports) {
    if (typeOnly) continue;
    const reason = violation(spec);
    if (reason) problems.push({ file: relative(repoRoot, file), line, reason });
  }
}

if (problems.length === 0) {
  console.log("widget-import-guard: OK — all src/widgets modules import only allowlisted deps.");
  process.exit(0);
}

problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
console.error("widget-import-guard FAILED — these src/widgets imports would break the frozen widget.html bundle:\n");
for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.reason}`);
console.error(
  "\nWidget render modules (src/widgets/*) are bundled into the deployed serve plane's frozen, self-contained" +
  "\nwidget.html. They may import ONLY:" +
  `\n  • packages: ${[...WIDGET_PKG_ALLOWLIST].join(", ")}` +
  "\n  • @kit / @kit/* (the ui-kit dumb-UI library — route icons and primitives through here, not lucide-react)" +
  "\n  • relative ./* siblings, and ../{" + KNOWN_PARENT_PREFIXES.join(",") + "}" +
  "\n\nNeed a new dependency? Add it deliberately, in ONE place, to" +
  "\nscripts/widget-import-allowlist.mjs — the single source of truth both this guard" +
  "\nand fused/static-ui/build.mjs read (it must be a bounded, intentional addition).",
);
process.exit(1);
