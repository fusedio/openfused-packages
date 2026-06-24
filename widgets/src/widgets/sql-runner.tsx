// widgets/sql-runner.tsx — a container that runs a NAMED query once and exposes
// its result to descendant queries as {{name}}. A subset of the application's
// `sql-runner` (spec/ui/json-ui-widgets-batch1.md § Deferred: sql-runner).
//
// props.name + props.sql define a SERVER-SIDE SOURCE, not a rendered query: the
// planner registers `name` as a local-view source (a third source tier ahead of
// the udfs/ registry), the resolver runs `sql` ONCE — recursively, in a hardened
// DuckDB connection, exactly like a UDF source — and any descendant `sql` that
// reads {{name}} sees the result. A $param inside `sql` re-resolves every
// descendant query that reads {{name}}.
//
// The RENDERER is a passthrough container (layout-transparent via `display:
// contents` on .ofw-sql-runner): it just lays out its children; `name`/`sql`
// produce no visual output. The {{name}} data binding is resolved entirely
// server-side, so this renderer carries no data logic.
import React from "react";
import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

export const sqlRunnerProps = z
  .object({
    name: z
      .string()
      .describe(
        "The local view name descendants reference as {{name}}. Must be unique within the config and must not collide with a UDF name.",
      ),
    sql: z
      .string()
      .describe(
        "DuckDB SQL run once; its result is registered as {{name}} for descendant queries. May reference {{udf}}s and $params (a $param here re-resolves every descendant that reads {{name}}).",
      ),
    maxRows: z
      .number()
      .optional()
      .describe("Safety LIMIT appended to the SQL when it has no LIMIT clause (default 10000)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type SqlRunnerProps = z.infer<typeof sqlRunnerProps>;

function SqlRunner({ element }: ComponentRenderProps<SqlRunnerProps>) {
  const { style } = element.props;
  return (
    <div className="ofw-sql-runner" style={parseStyle(style)}>
      {element.children as React.ReactNode}
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: SqlRunner,
    props: sqlRunnerProps,
    description:
      "Container that runs a named query once (props.name + props.sql) and exposes its result to descendant queries as {{name}}. The query is a server-side source, not a rendered output; children render normally.",
    hasChildren: true,
  }),
  writesParam: false,
};

export default definition;
