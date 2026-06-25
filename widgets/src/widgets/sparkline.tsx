// widgets/sparkline.tsx — a standalone tiny trend (sparkline) bound to a DuckDB
// query.
//
// An OpenFused-owned display primitive (NO app-parity constraint): a compact,
// axis/grid/tooltip-less trend line for a single numeric series. It is the
// SQL-bound wrapper around the pure presentational `<Sparkline>` helper
// (./_sparkline) — that helper is reused inline by the `kpi` tile, so the trend
// look stays single-sourced; this widget only adds the data binding + card
// chrome + status states.
//
// Authored ONLY against `@fusedio/widget-sdk` (+ the local helpers): it reads
// `element.props`, declares its props with a real-zod
// `z.object({...}).extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(...)`, and
// default-exports a `defineComponent({...})` plus `writesParam: false`.
//
// Data convention: the query returns a numeric SERIES (oldest → newest). We
// prefer a column named "value" (case-insensitive) and otherwise fall back to
// the first numeric column, coercing each cell to a Number and dropping NaNs.
// At least two points are required to draw a trend.
//
// `queryId` is threaded from `element.props._queryId` (the openfused binding
// convention) and the universal `style` prop is read off `element.props.style`.

import React, { useMemo } from "react";
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import { Sparkline } from "./_sparkline";
import type { ComponentDef } from "./types";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";

// ----------------------------------------------------------------- props schema
//   sql, title, color, area, height, strokeWidth
//   + the universal `style` prop folded in once via UNIVERSAL_PROPS.shape.
export const sparklineProps = z
  .object({
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL with {{udf_name}} and $param_name placeholders, returning a numeric series (oldest → newest). Prefers a 'value' column (case-insensitive); otherwise the first numeric column is used.",
      ),
    title: z
      .string()
      .optional()
      .describe("Optional title displayed above the sparkline."),
    color: z
      .string()
      .optional()
      .default("var(--ofw-accent)")
      .describe(
        "Stroke (and fill-gradient base) color. Default is the lime accent.",
      ),
    area: z
      .boolean()
      .optional()
      .default(true)
      .describe("Fill the area under the line."),
    height: z
      .number()
      .optional()
      .default(56)
      .describe("Pixel height of the sparkline. Default 56."),
    strokeWidth: z
      .number()
      .optional()
      .default(2)
      .describe("Stroke width of the trend line in pixels. Default 2."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type SparklineProps = z.infer<typeof sparklineProps>;

// --------------------------------------------------------------- series read
/**
 * Extract the numeric series from the resolved rows.
 *
 * Column priority: a column literally named "value" (case-insensitive) wins;
 * otherwise the FIRST column whose first non-null cell is numeric is used. Each
 * cell is coerced to a Number and NaNs are dropped, so a sparse/dirty series
 * still draws from its valid points.
 */
function extractSeries(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
): number[] {
  if (rows.length === 0) return [];
  const keys = columns.length > 0 ? columns : Object.keys(rows[0]);
  const isNum = (v: unknown) =>
    v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

  let key = keys.find((k) => k.toLowerCase() === "value");
  if (key === undefined) {
    key = keys.find((k) => rows.some((r) => isNum(r[k])));
  }
  if (key === undefined) return [];

  return rows
    .map((r) => Number(r[key as string]))
    .filter((n) => !Number.isNaN(n));
}

// -------------------------------------------------------------------- component
function SparklineWidget({ element }: ComponentRenderProps<SparklineProps>) {
  const {
    sql,
    title,
    color = "var(--ofw-accent)",
    area = true,
    height = 56,
    strokeWidth = 2,
    style,
  } = element.props;
  const queryId = (element.props as { _queryId?: string })._queryId;

  const { rows, columns, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  const series = useMemo(() => extractSeries(rows, columns), [rows, columns]);

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="text" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (series.length < 2) {
    body = <EmptyState label="No data" />;
  } else {
    body = (
      <Sparkline
        data={series}
        color={color}
        area={area}
        height={height}
        strokeWidth={strokeWidth}
      />
    );
  }

  return (
    <Card title={title} className="ofw-card--sparkline" style={parseStyle(style)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: SparklineWidget,
    props: sparklineProps,
    description:
      "Standalone tiny trend (sparkline) powered by a DuckDB SQL query; extracts a numeric series from a 'value' column (case-insensitive) or the first numeric column.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
