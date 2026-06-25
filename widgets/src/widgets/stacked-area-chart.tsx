// widgets/stacked-area-chart.tsx — stacked area chart (recharts) bound to a
// DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/stacked-area-chart.tsx): the prop contract here is a strict SUBSET
// of the app's with identical names/types/semantics, so a config authored
// against openfused pastes straight into the app. Authored ONLY against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql: props.sql, queryId })`, styles via
// `parseStyle(props.style)`, default-exports `defineComponent({...})` + the
// `writesParam` flag.
//
// This SUPERSEDES the legacy openfused area-chart (wide-format x + N value
// columns, fixed `height`, toggleable `stacked`). The app convention is adopted
// EXACTLY instead — an intentional break, not a clean superset:
//   • the query returns LONG/tidy `label`, `series`, `value` columns;
//   • rows are pivoted client-side into one row per distinct `label`
//     (first-seen order) with one numeric key per distinct `series`
//     (cell = sum of `value` for that label/series), case-insensitive
//     fallbacks `label|Label`, `series|Series` (default literal 'value'),
//     `value|Value` (default 0);
//   • stacking is unconditional (every Area uses stackId="stack");
//   • dropped: `x`, `y`, `height`, `stacked` (no app equivalent); sizing is
//     container-driven (ResponsiveContainer fills its flex parent).
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
//   • zod is stubbed at render time, so every prop default (areaOpacity = 0.6,
//     curveType = "smooth", …) is ALSO applied in the component body via
//     destructuring defaults, exactly as the app does.

import React, { useMemo } from "react";
import { z } from "zod";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
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
// Mirrors the application stacked-area-chart prop contract exactly (a subset is
// allowed; every prop below shares the app's name/type/semantics):
//   sql (required), title, areaOpacity, curveType, showGrid, showLegend,
//   showBrush, brushHeight, rotateLabels, xAxisFontSize, yAxisFontSize,
//   beginAtZero, yMin, yMax, bottomMargin, animationMs,
//   + the universal `style` prop folded in from _universal.ts.
export const stackedAreaChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label', 'series', and 'value' columns.",
      ),
    title: z
      .string()
      .optional()
      .describe("Chart title displayed above the chart."),
    colors: z
      .array(z.string())
      .optional()
      .describe(
        "Series/slice color palette (hex strings), used cyclically. Overrides the default palette.",
      ),
    areaOpacity: z
      .number()
      .optional()
      .default(0.6)
      .describe("Opacity of each stacked area from 0 to 1."),
    curveType: z
      .enum(["linear", "smooth", "step"])
      .optional()
      .default("smooth")
      .describe("Interpolation curve type."),
    showGrid: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show subtle grid lines behind the chart."),
    showLegend: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show legend for stacked series."),
    showBrush: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show brush slider for range selection."),
    brushHeight: z
      .number()
      .optional()
      .default(30)
      .describe("Height of brush slider in pixels."),
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
        "Axis TITLE for the horizontal (x) axis — names what the axis represents, e.g. 'Date'. Always set this so the chart is self-explaining; separate from the per-tick labels.",
      ),
    yAxisLabel: z
      .string()
      .optional()
      .describe(
        "Axis TITLE for the vertical (y) axis — names what the axis represents, e.g. 'Visitors'. Always set this so the chart is self-explaining; separate from the per-tick labels.",
      ),
    beginAtZero: z
      .boolean()
      .optional()
      .default(true)
      .describe("Force y-axis to start at zero."),
    yMin: z.number().optional().describe("Fixed minimum y-axis value."),
    yMax: z.number().optional().describe("Fixed maximum y-axis value."),
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

type StackedAreaChartProps = z.infer<typeof stackedAreaChartProps>;

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

/** curveType → recharts Area `type`. */
const CURVE_MAP = {
  linear: "linear" as const,
  smooth: "monotone" as const,
  step: "stepAfter" as const,
};

/** Compact axis formatting: 1_500 → "2K", 2_300_000 → "2.3M". */
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
function StackedAreaChartWidget({
  element,
}: ComponentRenderProps<StackedAreaChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    colors,
    areaOpacity = 0.6,
    curveType = "smooth",
    showGrid = true,
    showLegend = true,
    showBrush = true,
    brushHeight = 30,
    rotateLabels = true,
    xAxisFontSize = 11,
    yAxisFontSize = 11,
    xAxisLabel,
    yAxisLabel,
    beginAtZero = true,
    yMin,
    yMax,
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

  const curve = CURVE_MAP[curveType];
  const showLegendBlock = showLegend && seriesKeys.length > 1;
  const palette =
    Array.isArray(colors) && colors.length > 0 ? colors : SERIES_PALETTE;

  // Auto x-axis height so rotated labels (and the brush) are not clipped.
  const autoXAxisHeight = useMemo(() => {
    const brushPad = showBrush ? 20 : 0;
    if (!rotateLabels || chartData.length === 0) return 28 + brushPad + xTitlePad;
    const longest = chartData.reduce<string>((a, b) => {
      const next = String(b.label ?? "");
      return next.length > a.length ? next : a;
    }, "");
    const estimate = longest.length * xAxisFontSize * 0.55;
    return (
      Math.ceil(Math.max(estimate * Math.sin(Math.PI / 4) + 16, 50)) + brushPad + xTitlePad
    );
  }, [chartData, rotateLabels, xAxisFontSize, showBrush, xTitlePad]);

  const resolvedBottom = bottomMargin ?? 6;

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
      <div className="ofw-chart ofw-chart--area">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{
              top: showLegendBlock ? 36 : 8,
              right: 12,
              left: yTitlePad,
              bottom: resolvedBottom,
            }}
          >
            {showGrid ? (
              <CartesianGrid
                strokeDasharray="3 3"
                strokeOpacity={0.15}
                vertical={false}
              />
            ) : null}

            <XAxis
              dataKey="label"
              tick={{ fontSize: xAxisFontSize }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              angle={rotateLabels ? -45 : 0}
              textAnchor={rotateLabels ? "end" : "middle"}
              interval={
                chartData.length > 10 ? Math.floor(chartData.length / 8) : 0
              }
              height={autoXAxisHeight}
              label={xTitle}
            />

            <YAxis
              tick={{ fontSize: yAxisFontSize }}
              tickLine={false}
              axisLine={false}
              width={55 + yTitlePad}
              tickFormatter={compactTick}
              domain={[
                yMin != null ? yMin : beginAtZero ? 0 : "auto",
                yMax != null ? yMax : "auto",
              ]}
              label={yTitle}
            />

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
                iconType="plainline"
                wrapperStyle={{ fontSize: 11 }}
              />
            ) : null}

            {showBrush ? (
              <Brush
                dataKey="label"
                height={brushHeight}
                stroke="#93a0b2"
                fill="#1a1a1a"
                travellerWidth={10}
                tickFormatter={() => ""}
                padding={{ top: 8, bottom: 0, left: 0, right: 0 }}
              />
            ) : null}

            {seriesKeys.map((key, i) => {
              const color = palette[i % palette.length];
              return (
                <Area
                  key={key}
                  type={curve}
                  dataKey={key}
                  stackId="stack"
                  name={key}
                  stroke={color}
                  fill={color}
                  fillOpacity={areaOpacity}
                  isAnimationActive={animationMs > 0}
                  animationDuration={animationMs}
                />
              );
            })}
          </AreaChart>
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
    component: StackedAreaChartWidget,
    props: stackedAreaChartProps,
    description: "Stacked area chart driven by DuckDB SQL query.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
