// widgets/text.tsx — static or dynamic single-value text display.
//
// Aligned to the application `text` component
// (application/client/src/udfrun/json-ui/components/text.tsx). This is a FULL
// contract replacement of the old openfused markdown component: the app `text`
// is NOT a markdown renderer — it is a single-value text display whose contract
// is `value` / `sql` / `variant` (+ the two universal props). The old `content`
// prop and the `react-markdown` / `ofw-md` wrapper are gone.
//
// Authored ONLY against `@fusedio/widget-sdk`: reads `element.props`, declares
// real-zod props `.extend(UNIVERSAL_PROPS.shape)`, binds data through
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(props.style)`
// (the universal css→style rename), and default-exports `defineComponent({...})`
// plus the `writesParam: false` flag the generator reads.
//
// Priority (identical to the app): sql > value.
//   • `sql` (highest): first row, first column of the DuckDB result, coerced to
//     string; empty/null cell → "". While the query is loading we show
//     "Loading..." (the app's `finalText` loading branch).
//   • `value`: the literal text. The app additionally resolves inline
//     `$param_name`/`{{udf_name}}` placeholders in `value` via
//     `useParamSubstitution`, which is OUTSIDE openfused's allowed import set.
//     The prop NAME/TYPE/SEMANTICS are preserved (primary text source, lower
//     priority than `sql`); inline placeholder substitution within `value` is a
//     deliberate BEHAVIOURAL SUBSET — the app substitutes, openfused renders the
//     authored string as-is. Identical CONFIG semantics, reduced dynamism.
//
// `variant` drives BOTH the wrapper element and its className (identical enum
// and element-selection semantics to the app): h1/h2/h3/h4 → matching heading
// tag, "large" → <p>, everything else → <span>. The app applies Tailwind/shadcn
// classes (text-sm, text-muted-foreground, scroll-m-20 …) which openfused cannot
// import; the same semantics are reproduced with lightweight `ofw-text--<variant>`
// classNames. Rendering need not be pixel-identical — config semantics are.
//
// `queryId` is read off `element.props._queryId` (the resolver-stamped binding
// id) and threaded into the hook, mirroring the stat.tsx pattern; render.tsx
// also provides it via context, so passing it explicitly keeps the data
// dependency legible at the call site.

import { z } from "zod";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import { SkeletonState } from "../components/card";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// Subset of the application `text` contract — IDENTICAL prop names, types and
// semantics: value, sql, variant, + the universal `style` prop.
export const textProps = z
  .object({
    value: z
      .string()
      .optional()
      .default("")
      .describe(
        "The text value to display. Supports $param_name and {{udf_name}} placeholders that are substituted before display. Lower priority than sql.",
      ),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL query with {{ref}}/$param placeholders. Returns the first row's first column value, coerced to string. Highest priority.",
      ),
    variant: z
      .enum(["default", "muted", "small", "large", "h1", "h2", "h3", "h4"])
      .optional()
      .default("default")
      .describe("Typography variant; also selects the rendered HTML element."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type TextProps = z.infer<typeof textProps>;

// --------------------------------------------------------------------- variants
// Element selection per variant (identical semantics to the app):
//   h1/h2/h3/h4 → heading tags, "large" → <p>, otherwise → <span>.
type Variant = NonNullable<TextProps["variant"]>;

function elementForVariant(variant: Variant): "h1" | "h2" | "h3" | "h4" | "p" | "span" {
  switch (variant) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return variant;
    case "large":
      return "p";
    default:
      return "span";
  }
}

// -------------------------------------------------------------------- component
function Text({ element }: ComponentRenderProps<TextProps>) {
  const { value = "", sql, variant = "default" } = element.props;
  // `style` is the universal inline-style string (the css→style rename). The
  // openfused _universal.ts still declares `css`, so `style`/`_queryId` are read
  // off a narrow typed view of element.props — same pattern as stat.tsx — and
  // this component is correct independent of the universal-layer migration.
  const { _queryId: queryId, style } = element.props as {
    _queryId?: string;
    style?: string;
  };

  // SQL value (highest priority). The hook stays inert when no sql is authored.
  const { rows, columns, loading } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  // Extract first row, first column → string ("" for empty/null cell).
  let sqlValue = "";
  if (sql && rows.length > 0) {
    const firstRow = rows[0];
    const firstCol = columns[0] ?? Object.keys(firstRow)[0];
    const cell = firstCol !== undefined ? firstRow[firstCol] : null;
    sqlValue = cell !== null && cell !== undefined ? String(cell) : "";
  }

  // Render priority: sql > value (matches the app). NOTE: openfused renders
  // `value` as authored — inline $param/{{udf}} substitution within `value` is a
  // behavioural subset (see the file header); the prop semantics are preserved.
  const displayText = sqlValue || value || "";

  const Component = elementForVariant(variant);

  // While the sql query is resolving and no value has landed yet, show the shared
  // text skeleton instead of a "Loading..." string (one common loader across the
  // catalog — specs/rendering.md § Loading states). Once a value exists, keep it on
  // screen through a background re-resolve so the text doesn't flicker to a skeleton.
  if (sql && loading && displayText === "") {
    return (
      <Component className={`ofw-text ofw-text--${variant}`} style={parseStyle(style)}>
        <SkeletonState variant="text" />
      </Component>
    );
  }

  return (
    <Component className={`ofw-text ofw-text--${variant}`} style={parseStyle(style)}>
      {displayText}
    </Component>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Text,
    props: textProps,
    description: "Static or dynamic text display.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
