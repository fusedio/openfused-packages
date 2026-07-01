// scripts/render-check.ts — CLI wrapper around src/render-check.ts.
//
// Mounts a widget config headless and reports whether it throws during render —
// the class of bug `POST /api/exec/widget` (resolve-only) is blind to. See
// src/render-check.ts for the why.
//
// USAGE:
//   tsx scripts/render-check.ts <config.json> [resolved.json]
//     <config.json>   — the widget config (e.g. widgets/<stem>.json).
//     [resolved.json] — OPTIONAL `{ data, errors, depMap }` envelope from
//                        `POST /api/exec/widget`. Omit it to check the pure
//                        render path (enough to catch prop/structure crashes).
//
// EXIT CODE: 0 = rendered clean, 1 = threw (message printed), 2 = bad usage/input.
// A non-zero exit is a QA FAIL.

import { readFileSync } from "node:fs";

import { renderCheck, type ResolveEnvelope } from "../src/render-check";
import type { UINode } from "../src/render";

function loadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`render-check: could not read/parse ${path}: ${(err as Error).message}`);
    process.exit(2);
  }
}

function main(): void {
  const [configPath, resolvedPath] = process.argv.slice(2);
  if (!configPath) {
    console.error("usage: tsx scripts/render-check.ts <config.json> [resolved.json]");
    process.exit(2);
  }

  const config = loadJson(configPath) as UINode;
  const resolved = (resolvedPath ? loadJson(resolvedPath) : {}) as ResolveEnvelope;

  const result = renderCheck(config, resolved);
  if (!result.ok) {
    console.error(`FAIL — widget threw during render:\n  ${result.error}`);
    process.exit(1);
  }
  console.log("PASS — widget rendered without throwing.");
}

main();
