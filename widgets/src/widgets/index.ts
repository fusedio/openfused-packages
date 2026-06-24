// widgets/index.ts — the component barrel.
//
// This is the SINGLE module the render path and the schema generator import:
//
//   • render.tsx   imports { registry, type ComponentRenderer } and walks the
//                  {element} tree, resolving each node's `type` in `registry`.
//   • generate.ts  imports { componentDefs } and emits one JSON Schema per
//                  component from each def's `.props` zod schema (it imports the
//                  REAL zod; build.mjs aliases zod→../zod-stub for the render
//                  bundle so the schemas are inert there).
//
// The barrel collects the per-component definitions from `./components` (each
// component module default-/named-exports a `CatalogComponentDefinition` — the
// `{ component, props, description?, hasChildren? }` record produced by the
// SDK's `defineComponent`). `componentDefs` is the type-string → def map; the
// render `registry` is DERIVED from it (each def's `.component`) so the two can
// never drift: every renderable type has a schema and vice-versa.
//
// NOTE (stage ordering): `./components` and the per-component modules under
// `./components/` are authored by the exemplars/generator stage. Until they
// exist this import is unresolved — that is the only expected breakage here; the
// contract this barrel exposes is final.
import { componentDefs as defs } from "./components";
import { registryFromDefs } from "./types";
import type { ComponentRegistry, ComponentDefMap } from "./types";

export type {
  ComponentRenderer,
  ComponentRegistry,
  ComponentDef,
  ComponentDefMap,
} from "./types";

/** type-string → component definition (props zod schema + metadata). */
export const componentDefs: ComponentDefMap = defs;

/** type-string → renderer, derived from `componentDefs`. */
export const registry: ComponentRegistry = registryFromDefs(componentDefs);
