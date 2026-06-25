// widgets/funnel.tsx — conversion funnel (recharts) bound to a DuckDB query.
//
// An OpenFused-owned chart widget (no app-parity constraint): prop names are
// chosen freely but kept lowercase and consistent with the sibling charts
// (bar-chart / donut-chart). Authored ONLY against `@fusedio/widget-sdk` +
// recharts + the local helpers: it reads `element.props`, declares its props
// with real-zod `z.object({...}).extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(...)`, and
// default-exports `defineComponent({...})` PLUS `writesParam: false` (a chart
// never writes a param).
//
// Data convention (matching bar-chart / donut-chart): the query returns FIXED
// `label` + `value` columns (tolerating capitalized `Label`/`Value`), with rows
// already in descending order. We sort descending defensively so the funnel
// narrows top→bottom regardless of query order.
//
// Per-datum `fill`: recharts `Funnel` colors each trapezoid by the datum's
// `fill`. We derive a fade from the single accent `color` by mapping each stage
// to a decreasing fill-opacity stop, so the funnel reads as one hue stepping
// down in intensity (top stage solid, deepest stage faintest). `color` defaults
// to "var(--ofw-accent)" — recharts passes the literal through to the SVG
// `fill`, which resolves the CSS var.

import React from "react";
import { z } from "zod";
import {
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Tooltip,
} from "recharts";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { ChartTooltip } from "./_chart-tooltip";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";

// ----------------------------------------------------------------- props schema
// sql (required), title, color, showValues, showPercent, + the universal
// `style` prop folded in once via UNIVERSAL_PROPS.shape. The render-time zod
// stub does not apply `.default()`s, so each default is also re-applied as a JS
// fallback in the destructure below (the sibling charts do the same).
export const funnelProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label' and 'value' columns, in descending order (each stage smaller than the one above).",
      ),
    title: z.string().optional().describe("Chart title displayed above the funnel."),
    color: z
      .string()
      .optional()
      .default("var(--ofw-accent)")
      .describe(
        "Base fill color for the funnel. Each stage is rendered as a decreasing opacity of this color (top stage solid, deepest stage faintest). Default is the lime accent.",
      ),
    showValues: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show the numeric value on each stage."),
    showPercent: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Show each stage as a percentage of the first (top) stage, e.g. '42%'.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type FunnelProps = z.infer<typeof funnelProps>;

// ------------------------------------------------------------------- helpers

/** Compact value formatting: 1_500 → "2K", 2_300_000 → "2.3M". */
function compactValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

// A funnel stage, plus the derived per-datum `fill` recharts colors by, and the
// formatted right-side value/percent label text.
interface FunnelStage {
  label: string;
  value: number;
  fill: string;
  // The value/percent text rendered to the right of the trapezoid (empty when
  // both showValues and showPercent are off).
  valueLabel: string;
}

// -------------------------------------------------------------------- component
function FunnelWidget({ element }: ComponentRenderProps<FunnelProps>) {
  // Mirror the zod `.default()`s as JS fallbacks — the render-time zod stub does
  // not apply defaults.
  const {
    sql,
    title,
    color = "var(--ofw-accent)",
    showValues = true,
    showPercent = false,
  } = element.props;
  // `style` is the universal prop (lives in ./_universal.ts); read it off
  // element.props without redeclaring it. `queryId` is the resolver-stamped
  // binding id threaded into the hook (existing openfused convention).
  const style = (element.props as { style?: string }).style;
  const queryId = (element.props as { _queryId?: string })._queryId;

  const { rows, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="chart" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (rows.length === 0) {
    body = <EmptyState />;
  } else {
    // Fixed `label`/`value` columns (capitalized fallback), value coerced to
    // Number. Sort descending defensively so the funnel narrows top→bottom even
    // if the query did not order rows.
    const stages = (rows as Record<string, unknown>[])
      .map((row) => ({
        label: String(row.label ?? row.Label ?? ""),
        value: Number(row.value ?? row.Value ?? 0),
      }))
      .sort((a, b) => b.value - a.value);

    const top = stages.length > 0 ? stages[0].value : 0;
    const last = stages.length - 1;

    // Derive a fade: each stage steps down in fill-opacity from 1 (top) to a
    // floor of 0.35 (deepest), so the funnel reads as one hue darkening top to
    // bottom. recharts honors `fillOpacity` per datum via the `fill` shape, but
    // since `color` may be a CSS var (which recharts passes through to SVG), we
    // bake the opacity into the alpha-less color by pairing each datum's `fill`
    // with a separate `fillOpacity` on the Funnel — instead we set per-datum
    // fill to the same color and let LabelList carry the contrast. To keep the
    // step visible we store the computed opacity and apply it via the shape.
    const chartData: FunnelStage[] = stages.map((s, i) => {
      const t = last > 0 ? i / last : 0; // 0 at top → 1 at bottom
      const opacity = 1 - t * 0.65; // 1 → 0.35
      const pct = top > 0 ? Math.round((s.value / top) * 100) : 0;
      const parts: string[] = [];
      if (showValues) parts.push(compactValue(s.value));
      if (showPercent) parts.push(`${pct}%`);
      return {
        label: s.label,
        value: s.value,
        fill: color,
        valueLabel: parts.join("  ·  "),
        // recharts reads `fillOpacity` off the datum for the trapezoid shape.
        fillOpacity: opacity,
      } as FunnelStage & { fillOpacity: number };
    });

    const showStageLabel = showValues || showPercent;

    body = (
      <div className="ofw-chart ofw-chart--funnel">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
            <Tooltip
              cursor={false}
              content={<ChartTooltip />}
              animationDuration={0}
            />
            <Funnel
              dataKey="value"
              nameKey="label"
              data={chartData}
              isAnimationActive={false}
              stroke="var(--ofw-bg)"
              strokeWidth={2}
            >
              {/* Stage name, drawn to the right of each trapezoid. */}
              <LabelList
                position="right"
                dataKey="label"
                fill="var(--ofw-text)"
                stroke="none"
                style={{ fontSize: 12 }}
              />
              {/* Value / percent, drawn centered inside each trapezoid. */}
              {showStageLabel ? (
                <LabelList
                  position="center"
                  dataKey="valueLabel"
                  fill="var(--ofw-bg)"
                  stroke="none"
                  style={{ fontSize: 11, fontWeight: 600 }}
                />
              ) : null}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Card title={title} className="ofw-card--chart" style={parseStyle(style)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: FunnelWidget,
    props: funnelProps,
    description:
      "Conversion funnel powered by a DuckDB SQL query; the query must return 'label' and 'value' columns in descending order. Each stage fades to a lower opacity of `color`. Toggle per-stage value and percent-of-top labels via showValues / showPercent.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
