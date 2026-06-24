// widgets/stacked-bar-chart.tsx — stacked bar chart (recharts) bound to a
// DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/stacked-bar-chart.tsx): the prop contract here is a strict SUBSET
// of the app's with identical names/types/semantics, so a config authored
// against openfused pastes straight into the app. Authored ONLY against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql: props.sql, queryId })`, styles via
// `parseStyle(props.style)`, default-exports `defineComponent({...})` + the
// `writesParam` flag.
//
// Data convention (adopted from the app EXACTLY): the query returns LONG/tidy
// `label`, `value`, optional `series` columns; rows are pivoted client-side
// into one row per distinct `label` (first-seen order) with one numeric key per
// distinct `series` (cell = sum of `value` for that label/series), with
// case-insensitive fallbacks label|Label, series|Series (default literal
// 'value'), value|Value (default 0). Stacking is unconditional (every Bar uses
// stackId="stack"). Single-series multi-color uses the shared SERIES_PALETTE;
// the single-series default fill is the Fused lime (#E8FF59), overridable via
// `barColor`.
//
// Differences from the app renderer (rendering parity is NOT required — CONFIG
// parity IS):
//   • app imports baseui / shadcn classNames / GlassLoadingOverlay; here we
//     reproduce the loading / error / empty states with the lightweight
//     LoadingState / ErrorState / EmptyState helpers and the shared Card chrome
//     so one failing query never blanks the dashboard.
//   • host-state seam: the app's `useDuckDbSqlQuery` is the same SDK hook; the
//     openfused renderer threads `queryId` from `element.props._queryId` (the
//     existing openfused binding convention) into the hook.
//   • zod is stubbed at render time, so every prop default is ALSO applied in
//     the component body via destructuring defaults, exactly as the app does.
//
// SUBSET note: `barColor` is the openfused single-series fill prop (mirrors the
// app's single-series color semantics); the app's purely-cosmetic props the
// app exposes elsewhere are intentionally omitted — never extra.

import React, { useMemo } from "react";
import { z } from "zod";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from "recharts";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";

// ----------------------------------------------------------------- props schema
// Mirrors the application stacked-bar-chart prop contract (a subset is allowed;
// every prop below shares the app's name/type/semantics):
//   sql (required), title, horizontal, showGrid, showLegend, showValues,
//   barColor, rotateLabels, xAxisFontSize, yAxisFontSize, beginAtZero,
//   bottomMargin, animationMs,
//   + the universal `style` prop folded in from _universal.ts.
export const stackedBarChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label' and 'value' columns; optional 'series' column splits each bar into a stack.",
      ),
    title: z
      .string()
      .optional()
      .describe("Chart title displayed above the chart."),
    barColor: z
      .string()
      .optional()
      .default("#E8FF59")
      .describe(
        "Bar fill color for the single-series case. Default is Fused lime yellow (#E8FF59). When the query returns a 'series' column, the palette is used instead.",
      ),
    colors: z
      .array(z.string())
      .optional()
      .describe(
        "Series/slice color palette (hex strings), used cyclically. Overrides the default palette.",
      ),
    horizontal: z
      .boolean()
      .optional()
      .default(false)
      .describe("Render horizontal stacked bars (categories on y-axis)."),
    showGrid: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show subtle grid lines behind bars."),
    showLegend: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show legend for stacked series."),
    showValues: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show the numeric value label on each bar segment."),
    rotateLabels: z
      .boolean()
      .optional()
      .default(true)
      .describe("Rotate x-axis labels by -45 degrees."),
    xAxisFontSize: z
      .number()
      .optional()
      .default(11)
      .describe("X-axis label font size in pixels."),
    yAxisFontSize: z
      .number()
      .optional()
      .default(11)
      .describe("Y-axis label font size in pixels."),
    xAxisLabel: z
      .string()
      .optional()
      .describe(
        "Axis TITLE for the horizontal (x) axis — names what the axis represents, e.g. 'Month'. Always set this so the chart is self-explaining; separate from the per-tick labels.",
      ),
    yAxisLabel: z
      .string()
      .optional()
      .describe(
        "Axis TITLE for the vertical (y) axis — names what the axis represents, e.g. 'Count'. Always set this so the chart is self-explaining; separate from the per-tick labels.",
      ),
    beginAtZero: z
      .boolean()
      .optional()
      .default(true)
      .describe("Force value axis to start at 0."),
    bottomMargin: z
      .number()
      .optional()
      .describe("Override bottom margin in pixels."),
    animationMs: z
      .number()
      .optional()
      .default(300)
      .describe(
        "Animation duration in milliseconds. 0 disables animation. Animation only plays on data changes, not on zoom/resize.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type StackedBarChartProps = z.infer<typeof stackedBarChartProps>;

// ------------------------------------------------------------------- helpers
// Ported from the application for parity (these are render behaviour, not props).

/** Series palette (matches the app's SERIES_PALETTE). */
const SERIES_PALETTE = [
  "#E8FF59",
  "#22d3ee",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#4ade80",
  "#f87171",
  "#38bdf8",
  "#facc15",
  "#c084fc",
];

/** Compact axis/label formatting: 1_500 → "2K", 2_300_000 → "2.3M". */
function compactTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

/** Lightweight tooltip (app uses shadcn classes; here a plain styled box with a
 *  total + per-series rows, approximating the app's ChartTooltip). */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce(
    (sum, entry) => sum + Number(entry.value ?? 0),
    0,
  );
  return (
    <div className="ofw-chart-tooltip">
      <div className="ofw-chart-tooltip__label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="ofw-chart-tooltip__row">
          <span
            className="ofw-chart-tooltip__swatch"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span className="ofw-chart-tooltip__name">{entry.name}</span>
          <span className="ofw-chart-tooltip__value">
            {Number(entry.value).toLocaleString()}
          </span>
        </div>
      ))}
      <div className="ofw-chart-tooltip__total">
        <span className="ofw-chart-tooltip__name">Total</span>
        <span className="ofw-chart-tooltip__value">
          {total.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- component
function StackedBarChartWidget({
  element,
}: ComponentRenderProps<StackedBarChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    barColor = "#E8FF59",
    colors,
    horizontal = false,
    showGrid = true,
    showLegend = true,
    showValues = false,
    rotateLabels = true,
    xAxisFontSize = 11,
    yAxisFontSize = 11,
    xAxisLabel,
    yAxisLabel,
    beginAtZero = true,
    bottomMargin,
    animationMs = 300,
  } = props;

  // recharts axis-title config (the `label` prop) + the room reserved for it.
  const xTitlePad = xAxisLabel ? 20 : 0;
  const yTitlePad = yAxisLabel ? 18 : 0;
  const xTitle = xAxisLabel
    ? {
        value: xAxisLabel,
        position: "insideBottom" as const,
        offset: 0,
        style: { fill: "var(--ofw-text-dim)", fontSize: 12, textAnchor: "middle" as const },
      }
    : undefined;
  const yTitle = yAxisLabel
    ? {
        value: yAxisLabel,
        angle: -90,
        position: "insideLeft" as const,
        style: { fill: "var(--ofw-text-dim)", fontSize: 12, textAnchor: "middle" as const },
      }
    : undefined;
  // The renderer threads `queryId` from useJsonUiBinding via element.props (the
  // existing openfused binding convention) and the universal `style` prop is
  // read off element.props per the org-wide css→style rename.
  const queryId = (element.props as { _queryId?: string })._queryId;
  const styleProp = (element.props as { style?: string }).style;

  const { rows, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  // Long/tidy → wide pivot adopted from the app EXACTLY: group rows by `label`
  // (first-seen order), collect distinct `series` into seriesKeys, sum `value`
  // per (label, series) into one numeric key per series. Case-insensitive
  // fallbacks: label|Label, series|Series (default 'value'), value|Value (0).
  const { chartData, seriesKeys } = useMemo(() => {
    if (!rows || rows.length === 0)
      return {
        chartData: [] as Record<string, number | string>[],
        seriesKeys: [] as string[],
      };

    const labelOrder: string[] = [];
    const labelSet = new Set<string>();
    const seriesSet = new Set<string>();
    const map = new Map<string, Record<string, number>>();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const label = String(row.label ?? row.Label ?? "");
      const series = String(row.series ?? row.Series ?? "value");
      const value = Number(row.value ?? row.Value ?? 0);

      if (!labelSet.has(label)) {
        labelSet.add(label);
        labelOrder.push(label);
      }
      seriesSet.add(series);

      const current = map.get(label) ?? {};
      current[series] = (current[series] ?? 0) + value;
      map.set(label, current);
    }

    const keys = Array.from(seriesSet);
    const data = labelOrder.map((label) => {
      const entry: Record<string, number | string> = { label };
      const vals = map.get(label) ?? {};
      for (const key of keys) {
        entry[key] = vals[key] ?? 0;
      }
      return entry;
    });

    return { chartData: data, seriesKeys: keys };
  }, [rows]);

  const showLegendBlock = showLegend && seriesKeys.length > 1;
  const singleSeries = seriesKeys.length <= 1;
  const palette =
    Array.isArray(colors) && colors.length > 0 ? colors : SERIES_PALETTE;

  // Auto x-axis height so rotated labels are not clipped (vertical layout only).
  const autoXAxisHeight = useMemo(() => {
    if (horizontal || !rotateLabels || chartData.length === 0) return 28 + xTitlePad;
    const longest = chartData.reduce<string>((a, b) => {
      const next = String(b.label ?? "");
      return next.length > a.length ? next : a;
    }, "");
    const estimate = longest.length * xAxisFontSize * 0.55;
    return Math.ceil(Math.max(estimate * Math.sin(Math.PI / 4) + 16, 48)) + xTitlePad;
  }, [chartData, horizontal, rotateLabels, xAxisFontSize, xTitlePad]);

  const resolvedBottom = (bottomMargin ?? 6) + (horizontal ? xTitlePad : 0);

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="chart" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (chartData.length === 0) {
    body = <EmptyState />;
  } else {
    body = (
      <div className="ofw-chart ofw-chart--bar">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{
              top: showLegendBlock ? 36 : 8,
              right: 12,
              left: (horizontal ? 8 : 0) + yTitlePad,
              bottom: resolvedBottom,
            }}
          >
            {showGrid ? (
              <CartesianGrid
                vertical={horizontal}
                strokeDasharray="3 3"
                strokeOpacity={0.15}
              />
            ) : null}

            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: xAxisFontSize }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compactTick}
                  domain={beginAtZero ? [0, "auto"] : ["auto", "auto"]}
                  label={xTitle}
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fontSize: yAxisFontSize }}
                  tickLine={false}
                  axisLine={false}
                  width={110 + yTitlePad}
                  interval={0}
                  label={yTitle}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: xAxisFontSize }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  angle={rotateLabels ? -45 : 0}
                  textAnchor={rotateLabels ? "end" : "middle"}
                  interval={0}
                  height={autoXAxisHeight}
                  label={xTitle}
                />
                <YAxis
                  tick={{ fontSize: yAxisFontSize }}
                  tickLine={false}
                  axisLine={false}
                  width={55 + yTitlePad}
                  tickFormatter={compactTick}
                  domain={beginAtZero ? [0, "auto"] : ["auto", "auto"]}
                  label={yTitle}
                />
              </>
            )}

            <Tooltip
              cursor={false}
              content={<ChartTooltip />}
              allowEscapeViewBox={{ x: false, y: true }}
              animationDuration={0}
            />

            {showLegendBlock ? (
              <Legend
                verticalAlign="top"
                height={28}
                wrapperStyle={{ fontSize: 11 }}
              />
            ) : null}

            {seriesKeys.map((key, i) => {
              const color = singleSeries
                ? colors?.[0] ?? barColor
                : palette[i % palette.length];
              return (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="stack"
                  name={key}
                  fill={color}
                  isAnimationActive={animationMs > 0}
                  animationDuration={animationMs}
                >
                  {showValues ? (
                    <LabelList
                      dataKey={key}
                      position={horizontal ? "right" : "top"}
                      formatter={
                        ((v: unknown) => compactTick(Number(v ?? 0))) as never
                      }
                      style={{ fontSize: 11 }}
                    />
                  ) : null}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Card
      title={title}
      className="ofw-card--chart"
      style={parseStyle(styleProp)}
    >
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: StackedBarChartWidget,
    props: stackedBarChartProps,
    description:
      "Stacked bar chart driven by a DuckDB SQL query; the query must return 'label' and 'value' columns, with an optional 'series' column to split each bar into a stack.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
