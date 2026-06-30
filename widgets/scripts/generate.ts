// scripts/generate.ts — emit the load-bearing `components.json` manifest from the
// component catalog (the SINGLE source of truth: src/widgets).
//
// For each entry in `componentDefs` (the barrel ./src/widgets walks ./components):
//   • run Zod 4's `z.toJSONSchema(def.props, {target:'draft-07', io:'input',
//     reused:'inline', unrepresentable:'any'})` (REAL zod here — NOT the render
//     stub) to get raw JSON Schema, then sanitize() it — used only for the LINT
//     check below; the per-type schema files are no longer emitted.
//   • contribute one entry to `components.json` = { version, components:
//     [{type, hasChildren, isInput: !!def.writesParam}], generatedFrom:
//     'packages/widgets/src/widgets' }, sorted. `components.json` is the only emitted artifact:
//     the Python side reads it for SUPPORTED_COMPONENTS / INPUT_COMPONENTS.
//
// LINT (throws): any component whose generated propsSchema.properties carries
// BOTH `param` and `defaultValue` but `writesParam !== true` — an INPUT that forgot
// to declare itself (it would silently fail the server-side isInput contract).
//
// OUTPUT DIR is overridable via OPENFUSED_WIDGETS_OUT (default the committed
// src/fused/agent_core/widgets dir). For the gate run it points at /tmp/ofw-gen so the
// committed components.json is never touched.
//
// recharts mitigation: importing the barrel pulls bar-chart.tsx → `recharts`,
// whose ESM entry references browser globals at module-eval time. Under node
// (tsx) those are absent. We install minimal `globalThis` shims (process.env,
// global, a no-op getComputedStyle, and a document/window stub) BEFORE a DYNAMIC
// import of the barrel, so the module graph evaluates without a ReferenceError.
// Only schema METADATA is read — no renderer is ever invoked — so the shims need
// not be faithful, just present.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { sanitizePropsSchema, type JsonSchema } from "./sanitize";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------- browser shims
// Install before importing the barrel (recharts touches these at module load).
function installBrowserShims(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.process) g.process = { env: {} };
  if (!g.global) g.global = globalThis;
  const noopStyle = {
    getPropertyValue: () => "",
  };
  if (typeof (g as { getComputedStyle?: unknown }).getComputedStyle !== "function") {
    (g as { getComputedStyle?: unknown }).getComputedStyle = () => noopStyle;
  }
  // react-dom reads `navigator.userAgent` at module-eval time.
  if (!g.navigator) g.navigator = { userAgent: "node", platform: "node" };
  // react-dom's scheduler probes for these timing primitives at load.
  if (typeof g.requestAnimationFrame !== "function") {
    g.requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
  }
  if (typeof g.cancelAnimationFrame !== "function") {
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
  if (!g.window) g.window = g;
  if (!g.document) {
    g.document = {
      documentElement: { style: {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      getElementById: () => null,
      addEventListener() {},
      removeEventListener() {},
    };
  }
}

// ----------------------------------------------------------------- output dir
const DEFAULT_OUT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "openfused",
  "widgets",
);
const OUTPUT_DIR = process.env.OPENFUSED_WIDGETS_OUT
  ? path.resolve(process.env.OPENFUSED_WIDGETS_OUT)
  : DEFAULT_OUT;

const COMPONENTS_VERSION = 1;

interface ComponentManifestEntry {
  type: string;
  hasChildren: boolean;
  isInput: boolean;
}

async function main(): Promise<void> {
  installBrowserShims();

  // Dynamic import AFTER shims are installed (recharts evaluates at load).
  const { componentDefs } = await import("../src/widgets/index");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const types = Object.keys(componentDefs).sort((a, b) => a.localeCompare(b));
  const manifest: ComponentManifestEntry[] = [];

  for (const type of types) {
    const def = componentDefs[type];

    const rawPropsSchema = z.toJSONSchema(def.props, {
      target: "draft-07",
      io: "input",
      reused: "inline",
      unrepresentable: "any",
    });

    const propsSchema = sanitizePropsSchema(rawPropsSchema as JsonSchema);

    // ---- LINT: param + defaultValue without writesParam → an undeclared input.
    const props =
      propsSchema.properties && typeof propsSchema.properties === "object"
        ? (propsSchema.properties as Record<string, unknown>)
        : {};
    const hasParam = Object.prototype.hasOwnProperty.call(props, "param");
    const hasDefaultValue = Object.prototype.hasOwnProperty.call(props, "defaultValue");
    const writesParam = def.writesParam === true;
    if (hasParam && hasDefaultValue && !writesParam) {
      throw new Error(
        `[generate] LINT: component "${type}" exposes both 'param' and 'defaultValue' ` +
          `props but writesParam !== true. Declare writesParam: true (it is an INPUT).`,
      );
    }

    manifest.push({
      type,
      hasChildren: def.hasChildren ?? false,
      isInput: writesParam,
    });
  }

  const componentsManifest = {
    version: COMPONENTS_VERSION,
    components: manifest.sort((a, b) => a.type.localeCompare(b.type)),
    generatedFrom: "packages/widgets/src/widgets",
  };
  const componentsPath = path.join(OUTPUT_DIR, "components.json");
  fs.writeFileSync(
    componentsPath,
    JSON.stringify(componentsManifest, null, 2) + "\n",
    "utf-8",
  );
  console.log(`  wrote components.json`);

  console.log(`\nDone. Generated components.json for ${types.length} component(s)`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
