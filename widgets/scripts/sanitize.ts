// scripts/sanitize.ts — post-process Zod 4's `z.toJSONSchema()` output into the
// JSON Schema the openfused planner consumes.
//
// Ported verbatim (behaviour-for-behaviour) from
//   application/client/scripts/generate-json-ui-schemas.ts → sanitizePropsSchema
// which itself mirrors the workbench's runtime json-ui-json-schema.ts. The fixes:
//
//   1. drop `additionalProperties: false`        — Zod's `.strict()`-ish emit;
//      the planner schema is open (the workbench's strict linter runs elsewhere).
//   2. filter `required[]` of any prop carrying a `.default()`               —
//      a defaulted prop is OPTIONAL to the author; Zod still lists it as required
//      under `io:"input"`. Drop the whole `required` key when it empties out.
//   3. flatten a SINGLE-item oneOf/anyOf/allOf into its parent                —
//      `z.union([x])` / degenerate wrappers collapse to `x`'s keys (only ones
//      the parent doesn't already define).
//   4. strip `{ not: {} }` branches from oneOf/anyOf/allOf                    —
//      Zod 4 emits a `{not:{}}` (=never) member for some optional unions; it is
//      noise. Drop the keyword entirely if every member was stripped.
//   5. recurse into `properties` and `items`.
//
// IMPORTANT (matching application): we deliberately do NOT collapse a multi-
// member `anyOf` into a `type: [...]` array. openfused adopts Zod's natural
// `anyOf` union form for unions like `value` / `y`, exactly as application does.

export type JsonSchema = Record<string, unknown>;

export function sanitizePropsSchema(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== "object") return schema;

  const result = { ...schema };

  // (1) drop the closed-object marker.
  if (result.additionalProperties === false) {
    delete result.additionalProperties;
  }

  // (2) a defaulted prop is optional → drop it from `required`; drop empty.
  if (
    Array.isArray(result.required) &&
    result.properties &&
    typeof result.properties === "object"
  ) {
    const props = result.properties as Record<string, JsonSchema>;
    result.required = (result.required as string[]).filter((key) => {
      const prop = props[key];
      return prop && typeof prop === "object" && !("default" in prop);
    });
    if ((result.required as string[]).length === 0) {
      delete result.required;
    }
  }

  // (5a) recurse into properties.
  if (result.properties && typeof result.properties === "object") {
    const sanitizedProps: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(
      result.properties as Record<string, JsonSchema>,
    )) {
      sanitizedProps[key] = sanitizePropsSchema(value);
    }
    result.properties = sanitizedProps;
  }

  // (3)+(4) flatten single-item / strip {not:{}} branches in combinators.
  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    if (Array.isArray(result[keyword])) {
      const filtered = (result[keyword] as JsonSchema[])
        .filter((s) => {
          if (s && typeof s === "object" && "not" in s) {
            const notVal = s.not;
            if (
              notVal &&
              typeof notVal === "object" &&
              Object.keys(notVal as object).length === 0
            ) {
              return false;
            }
          }
          return true;
        })
        .map((s) => sanitizePropsSchema(s));

      if (filtered.length === 1) {
        const [single] = filtered;
        delete result[keyword];
        for (const [k, v] of Object.entries(single)) {
          if (!(k in result)) {
            result[k] = v;
          }
        }
      } else if (filtered.length > 0) {
        result[keyword] = filtered;
      } else {
        delete result[keyword];
      }
    }
  }

  // (5b) recurse into items.
  if (result.items && typeof result.items === "object") {
    result.items = sanitizePropsSchema(result.items as JsonSchema);
  }

  return result;
}
