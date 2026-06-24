// widgets/scatter-chart.tsx — scatter chart (recharts) bound to a DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/scatter-chart.tsx): the prop contract here is a strict SUBSET of
// the app's with identical names/types/semantics, so a config authored against
// openfused pastes straight into the app. Authored ONLY against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql: props.sql, queryId })`, styles via
// `parseStyle(props.style)`, default-exports `defineComponent({...})` + the
// `writesParam` flag.
//
// Data convention (adopted from the app EXACTLY): the query must return numeric
// `x` and `y` columns; optional `series` splits points into one <Scatter> per
// distinct series (palette colors), optional `size` drives bubble radius via a
// ZAxis, optional `label` shows in the tooltip. Case-insensitive fallbacks
// x|X, y|Y, series|Series (default 'value'), size|Size, label|Label.
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
// SUBSET note: `xLabel`/`yLabel` are the openfused axis-title props (mirroring
// the app's axis-naming semantics via recharts XAxis/YAxis name); the app's
// extra cosmetic bubble props are intentionally omitted — never extra.

import React, { useMemo } from "react";
import { z } from "zod";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
// Mirrors the application scatter-chart prop contract (a subset is allowed;
// every prop below shares the app's name/type/semantics):
//   sql (required), title, pointColor, showGrid, showLegend, xLabel, yLabel,
//   xAxisFontSize, yAxisFontSize, animationMs,
//   + the universal `style` prop folded in from _universal.ts.
export const scatterChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return numeric 'x' and 'y' columns. Optional: 'series', 'size', 'label'.",
      ),
    title: z
      .string()
      .optional()
      .describe("Chart title displayed above the chart."),
    pointColor: z
      .string()
      .optional()
      .default("#E8FF59")
      .describe(
        "Point color for single-series charts. Default is Fused lime yellow (#E8FF59). When the query returns a 'series' column, the palette is used instead.",
      ),
    colors: z
      .array(z.string())
      .optional()
      .describe(
        "Series/slice color palette (hex strings), used cyclically. Overrides the default palette.",
      ),
    showGrid: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show subtle grid lines behind points."),
    showLegend: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show legend when multiple series are present."),
    xLabel: z.string().optional().describe("Optional x-axis title."),
    yLabel: z.string().optional().describe("Optional y-axis title."),
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
    animationMs: z
      .number()
      .optional()
      .default(300)
      .describe(
        "Animation duration in milliseconds. 0 disables animation. Animation only plays on data changes, not on zoom/resize.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type ScatterChartProps = z.infer<typeof scatterChartProps>;

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

/** Default rendered point area when the query returns no `size` column. */
const DEFAULT_POINT_SIZE = 70;

/** Compact axis formatting: 1_500 → "2K", 2_300_000 → "2.3M". */
function compactTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

/** Lightweight tooltip (app uses shadcn classes; here a plain styled box). */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: Record<string, unknown>;
    name?: string;
    color?: string;
  }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload ?? {};
  const label = String(point.label ?? point.series ?? "");
  return (
    <div className="ofw-chart-tooltip">
      {label ? <div className="ofw-chart-tooltip__label">{label}</div> : null}
      <div className="ofw-chart-tooltip__row">
        <span className="ofw-chart-tooltip__name">x</span>
        <span className="ofw-chart-tooltip__value">
          {Number(point.x ?? 0).toLocaleString()}
        </span>
      </div>
      <div className="ofw-chart-tooltip__row">
        <span className="ofw-chart-tooltip__name">y</span>
        <span className="ofw-chart-tooltip__value">
          {Number(point.y ?? 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- component
function ScatterChartWidget({
  element,
}: ComponentRenderProps<ScatterChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    pointColor = "#E8FF59",
    colors,
    showGrid = true,
    showLegend = true,
    xLabel,
    yLabel,
    xAxisFontSize = 11,
    yAxisFontSize = 11,
    animationMs = 300,
  } = props;
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

  // Group points by `series` (default 'value'). Each point carries x, y, the
  // optional bubble size as `z`, and a `label`/`series` for the tooltip.
  // Case-insensitive fallbacks adopted from the app exactly.
  const { grouped, hasSeries, hasSize } = useMemo(() => {
    if (!rows || rows.length === 0)
      return {
        grouped: {} as Record<
          string,
          Array<{
            x: number;
            y: number;
            z: number;
            label: string;
            series: string;
          }>
        >,
        hasSeries: false,
        hasSize: false,
      };

    const out: Record<
      string,
      Array<{ x: number; y: number; z: number; label: string; series: string }>
    > = {};
    let anySize = false;

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const x = Number(row.x ?? row.X ?? 0);
      const y = Number(row.y ?? row.Y ?? 0);
      // Skip points with a non-numeric x/y — a NaN coordinate would distort
      // recharts' auto-computed domain (and render nothing useful anyway).
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const series = String(row.series ?? row.Series ?? "value");
      const rawSize = row.size ?? row.Size;
      if (rawSize !== undefined && rawSize !== null) anySize = true;
      const size = Number(rawSize ?? DEFAULT_POINT_SIZE);
      const label = String(row.label ?? row.Label ?? series);

      if (!out[series]) out[series] = [];
      out[series].push({
        x,
        y,
        z: Number.isFinite(size) ? size : DEFAULT_POINT_SIZE,
        label,
        series,
      });
    }

    return {
      grouped: out,
      hasSeries: Object.keys(out).length > 1,
      hasSize: anySize,
    };
  }, [rows]);

  const allPoints = useMemo(() => Object.values(grouped).flat(), [grouped]);

  const showLegendBlock = showLegend && hasSeries;
  const palette =
    Array.isArray(colors) && colors.length > 0 ? colors : SERIES_PALETTE;

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="chart" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (allPoints.length === 0) {
    body = <EmptyState />;
  } else {
    body = (
      <div className="ofw-chart ofw-chart--scatter">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            margin={{
              top: showLegendBlock ? 36 : 8,
              right: 12,
              left: yLabel ? 18 : 0,
              bottom: xLabel ? 24 : 6,
            }}
          >
            {showGrid ? (
              <CartesianGrid
                strokeDasharray="3 3"
                strokeOpacity={0.15}
                vertical={true}
              />
            ) : null}

            <XAxis
              type="number"
              dataKey="x"
              name={xLabel ?? "x"}
              tick={{ fontSize: xAxisFontSize }}
              tickLine={false}
              axisLine={false}
              tickFormatter={compactTick}
              domain={["auto", "auto"]}
              label={
                xLabel
                  ? {
                      value: xLabel,
                      position: "insideBottom",
                      offset: -8,
                      fontSize: xAxisFontSize,
                    }
                  : undefined
              }
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel ?? "y"}
              tick={{ fontSize: yAxisFontSize }}
              tickLine={false}
              axisLine={false}
              width={55}
              tickFormatter={compactTick}
              domain={["auto", "auto"]}
              label={
                yLabel
                  ? {
                      value: yLabel,
                      angle: -90,
                      position: "insideLeft",
                      // textAnchor:middle centers the rotated title along the axis
                      // (without it recharts anchors at the text start → clipped at
                      // the top). offset nudges it clear of the tick labels.
                      offset: 10,
                      style: { textAnchor: "middle", fontSize: yAxisFontSize },
                    }
                  : undefined
              }
            />
            {hasSize ? (
              <ZAxis type="number" dataKey="z" range={[10, 160]} />
            ) : null}

            <Tooltip
              cursor={{ strokeOpacity: 0.25 }}
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

            {Object.entries(grouped).map(([series, points], i) => (
              <Scatter
                key={series}
                name={series}
                data={points}
                fill={
                  hasSeries
                    ? palette[i % palette.length]
                    : colors?.[0] ?? pointColor
                }
                fillOpacity={0.85}
                isAnimationActive={animationMs > 0}
                animationDuration={animationMs}
              />
            ))}
          </ScatterChart>
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
    component: ScatterChartWidget,
    props: scatterChartProps,
    description:
      "Scatter chart driven by a DuckDB SQL query; the query must return numeric 'x' and 'y' columns, with optional 'series' (one scatter per series), 'size' (bubble radius), and 'label' (tooltip) columns.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
