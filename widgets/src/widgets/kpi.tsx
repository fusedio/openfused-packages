// widgets/kpi.tsx — a KPI tile: a big formatted value, a delta chip, an optional
// inline sparkline, and an optional target line.
//
// An OpenFused-owned widget (no app-parity constraint). Authored ONLY against
// `@fusedio/widget-sdk` + recharts (via the shared `Sparkline` helper) + React:
// it reads `element.props`, declares its props with a real-zod
// `z.object({...}).extend(UNIVERSAL_PROPS.shape)`, binds data through
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(...)`, and
// default-exports a `defineComponent({...})` plus the `writesParam: false` flag.
//
// Reuses the metric formatters (`formatValue`, `resolveRawValue` via "./metric")
// and the pure presentational `Sparkline` (via "./_sparkline") so the number
// formatting and the trend look are single-sourced with the sibling widgets.
//
// Data convention: `sql` returns a TIME-ORDERED series; the numeric series is the
// `value` column (case-insensitive) else the first numeric column. The metric is
// the LAST value; the sparkline is the whole series; the computed delta% is
// (last-first)/|first|*100. With <2 rows we fall back to the metric value
// resolution (sql first cell, else the static `value` prop).
//
// `queryId` is read off `element.props._queryId` (the resolver-stamped binding
// id) and threaded into the hook; the universal `style` prop is read off
// `element.props.style` in lockstep with the other widgets.

import React from "react";
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";
import { formatValue, resolveRawValue } from "./metric";
import { Sparkline } from "./_sparkline";

// ----------------------------------------------------------------- props schema
export const kpiProps = z
  .object({
    value: z
      .string()
      .optional()
      .describe(
        "Static value to display when sql is absent or returns <2 rows (the metric fallback).",
      ),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL with {{udf_name}} and $param_name placeholders, returning a TIME-ORDERED series. Its LAST value is the metric; the value-column series is the sparkline; the delta% is computed from first→last.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text shown below the number."),
    prefix: z
      .string()
      .optional()
      .default("")
      .describe('Text prepended before the formatted number (e.g. "$").'),
    suffix: z
      .string()
      .optional()
      .default("")
      .describe('Text appended after the formatted number (e.g. "%", " km²").'),
    format: z
      .enum(["compact", "comma", "none"])
      .optional()
      .default("compact")
      .describe(
        'How to format the number. "compact" abbreviates large values (e.g. 1.2M, 45.3K, 2.5B). "comma" adds thousand separators. "none" displays the raw value as-is.',
      ),
    decimals: z
      .number()
      .optional()
      .default(1)
      .describe("Number of decimal places used by compact/comma formatting."),
    delta: z
      .string()
      .optional()
      .describe(
        'Static delta chip text (e.g. "+12%"), overriding the value computed from the series.',
      ),
    deltaDirection: z
      .enum(["up", "down", "neutral"])
      .optional()
      .describe(
        "Override the delta direction (chip color + arrow). Inferred from the delta sign when absent.",
      ),
    target: z
      .number()
      .optional()
      .describe(
        "Optional target value; renders a Target line with a ✓/✗ depending on goodWhen.",
      ),
    goodWhen: z
      .enum(["above", "below"])
      .optional()
      .default("above")
      .describe(
        'When is the target met? "above" → value ≥ target is good; "below" → value ≤ target is good.',
      ),
    showSparkline: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show the inline trend sparkline (only when the series has ≥2 points)."),
    trendColor: z
      .string()
      .optional()
      .default("var(--ofw-accent)")
      .describe("Sparkline stroke/fill color. Defaults to the lime accent."),
    size: z
      .number()
      .optional()
      .default(48)
      .describe("Font size of the number in pixels. Default 48."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type KpiProps = z.infer<typeof kpiProps>;

// ------------------------------------------------------------------ series read
/**
 * Pick the numeric series column: the `value` column (case-insensitive) wins,
 * else the first column whose cells coerce to finite numbers. Returns the
 * numeric series (oldest → newest), dropping non-numeric cells.
 */
function readSeries(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
): number[] {
  if (rows.length === 0) return [];
  const keys = columns.length > 0 ? columns : Object.keys(rows[0]);
  const isNum = (v: unknown) => {
    const n = Number(v);
    return v !== null && v !== "" && !Number.isNaN(n);
  };
  // Prefer a column literally named "value" (case-insensitive).
  let col = keys.find((k) => k.toLowerCase() === "value");
  // Else the first column whose first present cell is numeric.
  if (col === undefined) col = keys.find((k) => isNum(rows[0][k]));
  if (col === undefined) return [];
  return rows
    .map((r) => Number(r[col as string]))
    .filter((n) => !Number.isNaN(n));
}

// -------------------------------------------------------------------- component
function Kpi({ element }: ComponentRenderProps<KpiProps>) {
  const {
    value = "",
    sql,
    label,
    prefix = "",
    suffix = "",
    format = "compact",
    decimals = 1,
    delta,
    deltaDirection,
    target,
    goodWhen = "above",
    showSparkline = true,
    trendColor = "var(--ofw-accent)",
    size = 48,
  } = element.props;
  const queryId = (element.props as { _queryId?: string })._queryId;
  const style = (element.props as { style?: string }).style;

  const { rows, columns, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  const series = readSeries(rows, columns);
  const hasSeries = series.length >= 2;

  // Main number (as a string for formatValue): the LAST series value when the
  // series has ≥2 points, else the metric fallback resolution.
  const rawValue = hasSeries
    ? String(series[series.length - 1])
    : resolveRawValue(sql, rows, columns, value);

  // Computed delta% from first→last (omitted when first is 0). Static `delta`
  // prop overrides it.
  let computedDelta: string | undefined;
  if (hasSeries) {
    const first = series[0];
    const last = series[series.length - 1];
    if (first !== 0) {
      const pct = ((last - first) / Math.abs(first)) * 100;
      computedDelta = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
  }
  const deltaText = delta ?? computedDelta;

  // Direction: explicit prop wins; else infer from the delta sign.
  let direction: "up" | "down" | "neutral" = "neutral";
  if (deltaDirection) {
    direction = deltaDirection;
  } else if (deltaText) {
    if (deltaText.trim().startsWith("-")) direction = "down";
    else if (deltaText.trim().startsWith("+")) direction = "up";
  }
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";

  // Target: met only when the number is numeric.
  const num = Number(rawValue);
  const hasNum = rawValue !== "" && !Number.isNaN(num);
  const targetSet = typeof target === "number";
  const targetMet =
    targetSet && hasNum
      ? goodWhen === "above"
        ? num >= (target as number)
        : num <= (target as number)
      : false;

  const fontSizePx = typeof size === "number" && size > 0 ? size : 48;
  const displayValue = formatValue(rawValue, format, decimals);

  let body: React.ReactNode;

  if (!sql && value === "") {
    body = <EmptyState label="No query" />;
  } else if (!!sql && loading && rows.length === 0) {
    body = <SkeletonState variant="metric" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (!!sql && rows.length === 0 && value === "") {
    body = <EmptyState />;
  } else {
    body = (
      <>
        <div className="ofw-kpi__top">
          <div className="ofw-kpi__value" style={{ fontSize: `${fontSizePx}px` }}>
            {prefix}
            {displayValue}
            {suffix}
          </div>
          {deltaText ? (
            <span className={`ofw-kpi__delta ofw-kpi__delta--${direction}`}>
              <span className="ofw-kpi__arrow" aria-hidden="true">
                {arrow}
              </span>
              {deltaText}
            </span>
          ) : null}
        </div>
        {label ? <div className="ofw-kpi__label">{label}</div> : null}
        {targetSet ? (
          <div
            className={`ofw-kpi__target ofw-kpi__target--${targetMet ? "ok" : "bad"}`}
          >
            <span className="ofw-kpi__target-mark" aria-hidden="true">
              {targetMet ? "✓" : "✗"}
            </span>
            Target {formatValue(String(target), format, decimals)}
          </div>
        ) : null}
        {showSparkline && hasSeries ? (
          <div className="ofw-kpi__spark">
            <Sparkline data={series} color={trendColor} height={48} />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Card className="ofw-card--kpi" style={parseStyle(style)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Kpi,
    props: kpiProps,
    description:
      "KPI tile: a big formatted value with a delta chip, an optional inline sparkline, and an optional target. Bind sql to a time-ordered series (its last value is the metric, the series drives the sparkline and the computed delta); or set a static value.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
