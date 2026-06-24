import type { CatalogComponentDefinition } from "./define-component";

/**
 * The single default export every catalog bundle ships:
 *
 *   export default defineCatalog({
 *     components: { "kebab-key": defineComponent({...}), ... },
 *     skill,    // string imported from "../SKILL.md" (esbuild text loader)
 *     summary,  // ≤240-char headline; REQUIRED when skill is present
 *   });
 *
 * `skill` and `summary` are co-required at the **type level** via function
 * overloads — TypeScript rejects `{components, skill}` and `{components,
 * summary}` because neither overload matches. There is intentionally NO
 * runtime validation here:
 *
 *   - Bundle-time throws would block the entire catalog load over a UI
 *     concern (e.g. a too-long summary). The workbench loader instead
 *     validates the loaded module and surfaces structured errors in the
 *     Custom Catalogs UI so the canvas can keep working.
 *   - The `/build` slash-command in catalog-template owns the
 *     SKILL.md ↔ defineCatalog wiring symmetry check.
 *
 * `defineCatalog` is therefore a pure type-narrowing identity, matching the
 * style of `defineComponent`.
 */

export interface CatalogDefinitionBase {
  components: Record<string, CatalogComponentDefinition<any>>;
}

export interface CatalogDefinitionWithSkill extends CatalogDefinitionBase {
  /**
   * Free-form markdown — author-supplied cross-component guidance the AI
   * fetches lazily via `get_catalog_skill`. Do **not** restate per-component
   * prop info here; that reaches the AI through each component's Zod schema
   * and the existing `get_json_ui_component_schemas` tool, and any
   * duplication will drift.
   */
  skill: string;
  /**
   * ≤240-char headline shown in the system prompt's
   * `<available_catalog_skills>` block so the AI can decide whether the
   * catalog is relevant before fetching the full skill. A longer summary is
   * truncated to 240 chars by the workbench loader (with a console warning)
   * rather than failing the catalog load.
   */
  summary: string;
}

export type CatalogDefinition =
  | CatalogDefinitionBase
  | CatalogDefinitionWithSkill;

export function defineCatalog<
  C extends Record<string, CatalogComponentDefinition<any>>,
>(def: {
  components: C;
  skill: string;
  summary: string;
}): CatalogDefinitionWithSkill;
export function defineCatalog<
  C extends Record<string, CatalogComponentDefinition<any>>,
>(def: { components: C }): CatalogDefinitionBase;
export function defineCatalog(def: {
  components: Record<string, CatalogComponentDefinition<any>>;
  skill?: string;
  summary?: string;
}): CatalogDefinition {
  return def as CatalogDefinition;
}
