import type * as React from "react";
import type { z } from "zod";

import type { ComponentRenderProps } from "./types";

/**
 * The shape a custom catalog registers per component type.
 *
 * Bundles default-export `{ "kebab-key": defineComponent({...}) }`. The
 * workbench reads `component` into its rendering registry and reads
 * `{ description, hasChildren, props }` into the **catalog schemas atom**
 * so the AI surfaces (widget-builder, canvas main chat, auto-fix, inline
 * edit) can see the type and the `get_json_ui_component_schemas` tool can
 * resolve its propsSchema.
 *
 * The `props` Zod schema is constructed against the workbench's Zod
 * instance at runtime: the catalog bundle marks `zod` as external, and the
 * host's runtime import map resolves the bare `import { z } from "zod"`
 * to its own already-loaded Zod. Your local devDependency on `zod` exists
 * only so TypeScript can infer the prop type from the schema — no Zod
 * code ships in your bundle.
 *
 * `props` must be a `z.ZodObject` (i.e. constructed with `z.object({...})`).
 * The workbench's props linter calls `.strict().safeParse()` on it to
 * validate widget JSON at the same fidelity as built-in components, and
 * that method only exists on `ZodObject`. Bundles that pass `z.union`,
 * `z.discriminatedUnion`, etc. are rejected at load time.
 */
export interface CatalogComponentDefinition<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  /** React function component. Receives `{ element }` per the json-ui contract. */
  component: React.ComponentType<ComponentRenderProps<TProps>>;
  /**
   * Zod schema for the component's props. Must be a `z.ZodObject` so the
   * workbench's strict-mode linter can run; use `z.infer<typeof MySchema>`
   * to derive the matching TS prop type and keep them in lockstep.
   */
  props: z.ZodObject<z.ZodRawShape>;
  /**
   * One-line description shown to the AI in the system prompt's custom-catalog
   * section. The AI uses this to decide when your component is appropriate;
   * keep it action-oriented (e.g. "A counter that writes a number to a param").
   */
  description?: string;
  /**
   * Whether this component accepts nested `children` in the json-ui tree.
   * Defaults to `false` — most catalog components are leaves.
   */
  hasChildren?: boolean;
}

/**
 * Typed helper for registering a catalog component.
 *
 * `TProps` is inferred from the React component's props only — never from
 * the Zod schema — because Zod 4's type instantiation through
 * `z.ZodType<T>` exceeds TypeScript's recursion budget for moderately
 * complex schemas. The author writes `type Props = z.infer<typeof
 * MySchema>` once and uses it on the component signature.
 *
 * Tradeoff: since `props` is typed as `z.ZodObject<z.ZodRawShape>` (not
 * `z.ZodType<TProps>`), TypeScript will *not* catch drift between the
 * Zod schema's shape and the component's `Props`. If you change one,
 * change the other — the runtime linter and renderer will surface the
 * mismatch, but the build won't.
 *
 * @example
 * import { z } from "zod";
 * import { defineComponent, useFusedParam, type ComponentRenderProps } from "@fusedio/widget-sdk";
 *
 * const CounterButtonProps = z.object({
 *   param: z.string().describe("Canvas param key to read/write"),
 *   label: z.string().optional().describe("Display label"),
 *   step: z.number().optional().default(1),
 * });
 * type Props = z.infer<typeof CounterButtonProps>;
 *
 * function CounterButton({ element }: ComponentRenderProps<Props>) {
 *   const { param, label = "Count", step = 1 } = element.props;
 *   const { value, setValue } = useFusedParam({ param, defaultValue: 0 });
 *   return <button onClick={() => setValue(value + step)}>{label}: {value}</button>;
 * }
 *
 * export default {
 *   "counter-button": defineComponent({
 *     component: CounterButton,
 *     props: CounterButtonProps,
 *     description: "A counter with +/- buttons that writes a number to a param.",
 *   }),
 * };
 */
export function defineComponent<TProps extends Record<string, unknown>>(def: {
  component: React.ComponentType<ComponentRenderProps<TProps>>;
  props: z.ZodObject<z.ZodRawShape>;
  description?: string;
  hasChildren?: boolean;
}): CatalogComponentDefinition<TProps> {
  return def as CatalogComponentDefinition<TProps>;
}
