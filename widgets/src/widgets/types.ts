// widgets/types.ts — the render/registry contract shared by the barrel, the
// renderer (render.tsx), and the generator (generate.ts).
//
// openfused does NOT depend on @json-render/react (application does). Its
// equivalents of that package's `ComponentRenderer` / `ComponentRegistry` are
// defined here in terms of the @fusedio/widget-sdk contract instead, so the
// whole render path stays on the SDK surface alone.
//
//   ComponentRenderer — a React component that takes the SINGLE `element` prop
//                       (`ComponentRenderProps` from the SDK) and reads
//                       `element.props`. NEVER spread `element`.
//   ComponentRegistry — `Record<typeString, ComponentRenderer>`, the map the
//                       renderer looks a node's `type` up in.
//   ComponentDef      — `CatalogComponentDefinition` from the SDK: the
//                       `{ component, props (zod), description?, hasChildren? }`
//                       record each component module default-exports. The
//                       barrel collects these into `componentDefs`; generate.ts
//                       walks `componentDefs` to emit the agent-facing JSON
//                       Schemas, and the barrel derives `registry` from the
//                       `.component` of each.
import type { ComponentType } from "react";
import type { z } from "zod";
import type { ComponentRenderProps } from "@fusedio/widget-sdk";

/**
 * A renderer is a React component over the SDK's `{element}` contract. The
 * renderer (render.tsx) invokes it as `<Renderer element={{type, props,
 * children}} />` — never spreading `element`.
 */
export type ComponentRenderer = ComponentType<ComponentRenderProps>;

/** type-string → renderer map the tree walk resolves a node's `type` against. */
export type ComponentRegistry = Record<string, ComponentRenderer>;

/**
 * The per-component definition each component module default-exports and the
 * barrel collects into `componentDefs`.
 *
 * Structurally the SDK's `CatalogComponentDefinition` (`{ component, props
 * (zod), description?, hasChildren? }`) PLUS one openfused-local field:
 *
 *   `writesParam` — true for INPUT components (select, slider, text-input, …)
 *                   that broadcast a value to the param store via
 *                   `useFusedParam`/`params.set`. generate.ts surfaces it as
 *                   each component's `isInput` flag in components.json, and the
 *                   generator LINT uses it to reject a component that exposes
 *                   BOTH a `param` and a `default` prop without declaring it.
 *
 * `component` is typed as `ComponentType<any>` rather than the SDK's
 * `ComponentType<ComponentRenderProps<TProps>>`: `ComponentRenderProps` is
 * INVARIANT in `TProps` (the component receives the props), so a specific
 * `ComponentRenderProps<{query: string; …}>` component is NOT assignable to the
 * default `ComponentRenderProps<Record<string, unknown>>`. Widening the stored
 * component to `any` lets the catalog map hold defs of differing prop shapes
 * (mirroring application's `componentDefinitions as const`, which keeps each
 * def's specific type rather than widening to a base). The renderer only ever
 * calls it as `<Component element={…} />`, so the loss of the prop type at the
 * map boundary is safe — each component file keeps its own typed signature.
 *
 * `defineComponent({...})` (from the SDK) does not know about `writesParam`, so
 * a component module spreads its result and appends the flag:
 *   `export default { ...defineComponent({...}), writesParam: false };`
 */
export interface ComponentDef {
  /** React function component over the `{element}` contract (`ComponentRenderProps`). */
  component: ComponentType<any>;
  /** Zod object schema for the component's props (real zod under generate.ts). */
  props: z.ZodObject<z.ZodRawShape>;
  /** One-line description shown to the agent in the catalog. */
  description?: string;
  /** Whether this component accepts nested `children`. Defaults to false. */
  hasChildren?: boolean;
  /** true if this component writes to a param (an INPUT component). */
  writesParam?: boolean;
}

/** type-string → definition map (the catalog the schema generator walks). */
export type ComponentDefMap = Record<string, ComponentDef>;

/** Derive the render registry from the catalog: take each def's `.component`. */
export function registryFromDefs(defs: ComponentDefMap): ComponentRegistry {
  const registry: ComponentRegistry = {};
  for (const [type, def] of Object.entries(defs)) {
    registry[type] = def.component as ComponentRenderer;
  }
  return registry;
}
