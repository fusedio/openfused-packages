// widgets/markdown.tsx — render Markdown text. Fused-owned primitive (no app
// `markdown` parity: the app `text` component is a single-value display and the
// old openfused markdown component was retired into `text`). This brings a
// dedicated Markdown renderer back as its OWN type so authors can surface prose,
// reports, and headings without hand-writing HTML (cf. the `html` escape hatch).
//
// Thin wrapper over the shared `MarkdownView` (../markdown-view) — the SAME
// renderer the app task thread uses (full consolidation). Authored only against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds data via `useDuckDbSqlQuery`, styles via
// `parseStyle(props.style)`, and default-exports `defineComponent({...})` plus the
// `writesParam: false` flag the generator reads.
//
// Priority (mirrors `text`): sql > value. `sql` returns the first row/first column
// coerced to string and rendered as markdown; `value` is the literal markdown
// source. While `sql` is loading the body shows "Loading...".
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { MarkdownView } from "../markdown-view";
import { SkeletonState } from "../components/card";

export const markdownProps = z
  .object({
    value: z
      .string()
      .optional()
      .default("")
      .describe(
        "Markdown source to render (headings, lists, links, code, blockquotes, tables). Lower priority than sql.",
      ),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL with {{ref}}/$param placeholders. Returns the first row's first column, coerced to string and rendered as markdown. Highest priority.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type MarkdownProps = z.infer<typeof markdownProps>;

function Markdown({ element }: ComponentRenderProps<MarkdownProps>) {
  const { value = "", sql } = element.props;
  const { _queryId: queryId, style } = element.props as {
    _queryId?: string;
    style?: string;
  };

  const { rows, columns, loading } = useDuckDbSqlQuery({ sql, queryId, enabled: !!sql });

  let sqlValue = "";
  if (sql && rows.length > 0) {
    const firstRow = rows[0];
    const firstCol = columns[0] ?? Object.keys(firstRow)[0];
    const cell = firstCol !== undefined ? firstRow[firstCol] : null;
    sqlValue = cell !== null && cell !== undefined ? String(cell) : "";
  }

  const text = sqlValue || value || "";

  // Show the shared text skeleton while the query resolves and nothing has landed
  // yet (one common loader across the catalog — specs/rendering.md § Loading
  // states), instead of a "Loading..." string.
  if (sql && loading && text === "") {
    return (
      <div className="ofw-md" style={parseStyle(style)}>
        <SkeletonState variant="text" />
      </div>
    );
  }

  return <MarkdownView text={text} style={parseStyle(style)} />;
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Markdown,
    props: markdownProps,
    description:
      "Render Markdown text — headings, lists, links, code, blockquotes, tables. Use this for prose / reports / notes; use `text` for a single value and `html` only when you need raw HTML. `value` is literal markdown; optional `sql` renders the first result cell as markdown.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
