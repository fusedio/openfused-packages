// widgets/gauge.tsx — radial progress gauge (recharts RadialBarChart) bound to a
// DuckDB query (or a static value).
//
// An OpenFused-owned widget (no application-parity constraint — prop names are
// chosen freely, kept lowercase and consistent with the metric/donut siblings).
// Authored ONLY against `@fusedio/widget-sdk` + recharts + the local helpers:
// reads `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// resolves its value through `useDuckDbSqlQuery({ sql, queryId })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// PLUS `writesParam: false` (a gauge never writes a param).
//
// Value resolution + formatting are SHARED with the metric widget: `resolveRawValue`
// picks the SQL first-cell (priority) or the static `value` prop, and `formatValue`
// applies the compact/comma/none formatting. The gauge then maps the number onto a
// [min, max] fraction and renders it as a 240° sweep.
//
// A single RadialBar can only fill a FRACTION of the arc by scaling against a
// numeric PolarAngleAxis whose domain is fixed [0, 100]; the bar's value is the
// percentage (0–100). The center value is an absolutely-positioned overlay
// (mirroring donut-chart's center total) so it does not steal height from the
// ResponsiveContainer and break the arc.

import React from "react";
import { z } from "zod";
import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
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

// ----------------------------------------------------------------- props schema
// Gauge-specific props folded together with the universal `style` prop via
// `.extend(UNIVERSAL_PROPS.shape)`. The zod `.default()`s below are mirrored as JS
// fallbacks in the destructure, because at render time openfused's zod is stubbed
// and does not apply defaults at runtime.
export const gaugeProps = z
  .object({
    value: z
      .string()
      .optional()
      .describe("Static value to display when no sql is given."),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL with {{udf_name}} and $param_name placeholders. The first cell of the first row is the gauge value (takes priority over `value`).",
      ),
    min: z
      .number()
      .optional()
      .default(0)
      .describe("Value mapped to an empty gauge (0% fill)."),
    max: z
      .number()
      .optional()
      .default(100)
      .describe("Value mapped to a full gauge (100% fill)."),
    label: z
      .string()
      .optional()
      .describe("Label text shown below the center value."),
    color: z
      .string()
      .optional()
      .default("var(--ofw-accent)")
      .describe("Fill color of the gauge arc."),
    trackColor: z
      .string()
      .optional()
      .default("var(--ofw-line-2)")
      .describe("Color of the empty track behind the arc."),
    format: z
      .enum(["compact", "comma", "none"])
      .optional()
      .default("none")
      .describe(
        'How to format the center value. "compact" abbreviates large values (e.g. 1.2M, 45.3K). "comma" adds thousand separators. "none" displays the raw value as-is.',
      ),
    decimals: z
      .number()
      .optional()
      .default(0)
      .describe("Number of decimal places used by compact/comma formatting."),
    suffix: z
      .string()
      .optional()
      .default("")
      .describe('Text appended after the center value (e.g. "%").'),
  })
  .extend(UNIVERSAL_PROPS.shape);

type GaugeProps = z.infer<typeof gaugeProps>;

// ------------------------------------------------------------------- helpers
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

// -------------------------------------------------------------------- component
function Gauge({ element }: ComponentRenderProps<GaugeProps>) {
  // Mirror the zod `.default()`s as JS fallbacks (render-time zod is stubbed).
  const {
    value = "",
    sql,
    min = 0,
    max = 100,
    label,
    color = "var(--ofw-accent)",
    trackColor = "var(--ofw-line-2)",
    format = "none",
    decimals = 0,
    suffix = "",
  } = element.props;
  // `style` is the universal prop (lives in ./_universal.ts); read off
  // element.props without redeclaring it. `queryId` is resolver-stamped.
  const style = (element.props as { style?: string }).style;
  const queryId = (element.props as { _queryId?: string })._queryId;

  const { rows, columns, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  // Resolve the raw value (SQL first-cell wins over the static `value`), then map
  // it onto the [min, max] fraction. A degenerate range (max <= min) → 0% fill.
  const rawValue = resolveRawValue(sql, rows, columns, value);
  const num = Number(rawValue);
  const span = max - min;
  const pct = span > 0 && !Number.isNaN(num) ? clamp((num - min) / span, 0, 1) : 0;
  const displayValue = formatValue(rawValue, format, decimals);

  // Show the skeleton ONLY before any value has resolved — once a static value or
  // server-resolved rows give us a number, render it even while a background
  // re-resolve keeps `loading` true (mirrors metric's "never blank resolved data").
  let body: React.ReactNode;

  if (!sql && value === "") {
    body = <EmptyState label="No value" />;
  } else if (!!sql && loading && rows.length === 0 && value === "") {
    body = <SkeletonState variant="metric" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else {
    body = (
      <div
        className="ofw-gauge"
        style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ v: pct * 100 }]}
            startAngle={210}
            endAngle={-30}
            innerRadius="70%"
            outerRadius="100%"
          >
            {/* A numeric angle axis fixed to [0, 100] scales the single bar to a
                fraction of the 240° sweep; ticks hidden so only the arc shows. */}
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="v"
              fill={color}
              background={{ fill: trackColor }}
              cornerRadius={999}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* Center overlay — absolutely positioned over the ring (like donut's
            center total) so it never steals height from the ResponsiveContainer. */}
        <div className="ofw-gauge__center" aria-hidden="true">
          <div className="ofw-gauge__value">
            {displayValue}
            {suffix}
          </div>
          {label ? <div className="ofw-gauge__label">{label}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <Card className="ofw-card--chart ofw-card--gauge" style={parseStyle(style)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Gauge,
    props: gaugeProps,
    description:
      "Radial progress gauge — maps a value (static or the first cell of a DuckDB SQL query) onto a [min, max] range and renders it as a 240° arc with the formatted value in the center.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
