// widgets/bar-chart.tsx — bar chart (recharts) bound to a DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/bar-chart.tsx): the prop contract here is a strict SUBSET of the
// app's with identical names/types/semantics, so a config authored against
// openfused pastes straight into the app. Authored ONLY against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql: props.sql, queryId })`, styles via
// `parseStyle(props.style)`, default-exports `defineComponent({...})` + the
// `writesParam` flag.
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
//
// Data convention (adopted from the app EXACTLY): the query must return a fixed
// two-column shape `label`, `value` (case-insensitive fallback to `Label`,
// `Value`); `value` is coerced to a Number. Single series only — no multi-series
// `y`, no `stacked`, no `x`/`height` props (sizing is container-driven).
//
// `clickParam` is an openfused FEEDBACK extension (spec/ui/json-ui.md § Actions &
// selection, NOT an app prop): when set, clicking a bar writes its category
// (the `label` value, a SCALAR string) to that param via the param store —
// usable for in-widget drill-down through the normal `$param`/depMap path, and
// it rides in every session feedback payload.

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
  LabelList,
} from "recharts";
import {
  useDuckDbSqlQuery,
  useFusedParam,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, SkeletonState, ErrorState, EmptyState } from "../components/card";

// ----------------------------------------------------------------- props schema
// Mirrors the application bar-chart prop contract exactly (a subset is allowed;
// every prop below shares the app's name/type/semantics):
//   sql (required), title, barColor, barOpacity, barRadius, hoverColor,
//   showGrid, rotateLabels, horizontal, showValues, xAxisFontSize,
//   yAxisFontSize, bottomMargin, beginAtZero, animationMs,
//   + the universal `style` prop folded in from _universal.ts.
export const barChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label' and 'value' columns.",
      ),
    title: z.string().optional().describe("Chart title displayed above the chart."),
    barColor: z
      .string()
      .optional()
      .default("#E8FF59")
      .describe("Bar fill color. Default is Fused lime yellow (#E8FF59)."),
    barOpacity: z
      .number()
      .optional()
      .default(1)
      .describe("Bar fill opacity from 0 (transparent) to 1 (solid)."),
    barRadius: z
      .number()
      .optional()
      .default(4)
      .describe("Corner radius of bars in pixels. 0 for sharp corners."),
    hoverColor: z
      .string()
      .optional()
      .describe(
        "Bar fill color on hover. If omitted, no hover highlight is shown.",
      ),
    showGrid: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show subtle horizontal grid lines behind bars."),
    rotateLabels: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Rotate x-axis labels -45 degrees. Useful for long category names.",
      ),
    horizontal: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, renders horizontal bars (categories on y-axis, values on x-axis). Good for ranked lists.",
      ),
    showValues: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show the numeric value label on each bar."),
    xAxisLabel: z
      .string()
      .optional()
      .describe(
        "Axis TITLE for the horizontal (x) axis — names what the axis represents, e.g. 'Species'. Always set this so the chart is self-explaining; it is separate from the per-tick category labels.",
      ),
    yAxisLabel: z
      .string()
      .optional()
      .describe(
        "Axis TITLE for the vertical (y) axis — names what the axis represents, e.g. 'Count'. Always set this so the chart is self-explaining; it is separate from the per-tick value labels.",
      ),
    xAxisFontSize: z
      .number()
      .optional()
      .default(11)
      .describe("Font size for x-axis labels in pixels."),
    yAxisFontSize: z
      .number()
      .optional()
      .default(11)
      .describe("Font size for y-axis labels in pixels."),
    bottomMargin: z
      .number()
      .optional()
      .describe(
        "Bottom margin in pixels. Overrides the auto-calculated value from rotateLabels. Useful when labels are clipped.",
      ),
    beginAtZero: z
      .boolean()
      .optional()
      .default(true)
      .describe("Force the value axis to start at 0."),
    animationMs: z
      .number()
      .optional()
      .default(300)
      .describe(
        "Bar animation duration in milliseconds. 0 disables animation. Default 300ms.",
      ),
    clickParam: z
      .string()
      .optional()
      .describe(
        "Param name that receives the clicked bar's category (its 'label' value, a scalar string). A click param can drive other queries via $param for in-widget drill-down, and rides in session feedback payloads.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type BarChartProps = z.infer<typeof barChartProps>;

// ------------------------------------------------------------------- helpers
// Ported from the application for parity (these are render behaviour, not props).

/** Compact axis/label formatting: 1_500 → "2K", 2_300_000 → "2.3M". */
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
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ofw-chart-tooltip">
      <div className="ofw-chart-tooltip__label">{label}</div>
      <div className="ofw-chart-tooltip__value">
        {Number(payload[0].value).toLocaleString()}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- component
function BarChartWidget({ element }: ComponentRenderProps<BarChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    barColor = "#E8FF59",
    barOpacity = 1,
    barRadius = 4,
    hoverColor,
    showGrid = false,
    rotateLabels = true,
    horizontal = false,
    showValues = false,
    xAxisLabel,
    yAxisLabel,
    xAxisFontSize = 11,
    yAxisFontSize = 11,
    bottomMargin,
    beginAtZero = true,
    animationMs = 300,
    clickParam,
  } = props;
  // The renderer threads `queryId` from useJsonUiBinding via element.props
  // (existing openfused convention) and the universal `style` prop is read off
  // element.props per the org-wide css→style rename.
  const queryId = (element.props as { _queryId?: string })._queryId;
  const styleProp = (element.props as { style?: string }).style;

  const { rows, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  // Click-to-param (spec/ui/json-ui.md § Actions & selection): clicking a bar
  // writes its category label (a SCALAR string) to `clickParam`. The hook is
  // called unconditionally (React rule); with `param: undefined` it is plain
  // local state and the write is a no-op. `broadcastDefaultValue: false`
  // keeps the param untouched until a click.
  const { setValue: setClickValue } = useFusedParam<string>({
    param: typeof clickParam === "string" && clickParam !== "" ? clickParam : undefined,
    defaultValue: "",
    broadcastDefaultValue: false,
  });
  const handleBarClick = React.useCallback(
    (entry: unknown) => {
      if (!clickParam) return;
      // recharts hands the bar's shape props; the data row sits on `payload`
      // (with the merged `label` as a fallback for older recharts shapes).
      const rec = entry as
        | { payload?: { label?: unknown }; label?: unknown }
        | null
        | undefined;
      const label = rec?.payload?.label ?? rec?.label;
      if (label === undefined || label === null) return;
      setClickValue(String(label));
    },
    [clickParam, setClickValue],
  );

  // Fixed two-column shape adopted from the app: label, value (capitalized
  // fallback), value coerced to Number.
  const chartData = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return rows.map((row) => ({
      label: String(
        (row as Record<string, unknown>).label ??
          (row as Record<string, unknown>).Label ??
          "",
      ),
      value: Number(
        (row as Record<string, unknown>).value ??
          (row as Record<string, unknown>).Value ??
          0,
      ),
    }));
  }, [rows]);

  // Extra room reserved for the axis TITLES (separate from the tick labels) so they
  // are never clipped over the ticks.
  const xTitlePad = xAxisLabel ? 20 : 0;
  const yTitlePad = yAxisLabel ? 18 : 0;

  // Auto x-axis height so rotated labels are not clipped (vertical layout only),
  // plus room for the x-axis title when present.
  const autoXAxisHeight = useMemo(() => {
    if (horizontal || !rotateLabels || chartData.length === 0) return 28 + xTitlePad;
    const longest = chartData.reduce(
      (a, b) => (b.label.length > a.length ? b.label : a),
      "",
    );
    let textWidth = longest.length * xAxisFontSize * 0.55;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = `${xAxisFontSize}px sans-serif`;
        textWidth = ctx.measureText(longest).width;
      }
    } catch {
      /* fallback to estimate */
    }
    const rotatedHeight = textWidth * Math.sin(Math.PI / 4);
    return Math.ceil(Math.max(rotatedHeight + 16, 50)) + xTitlePad;
  }, [chartData, horizontal, rotateLabels, xAxisFontSize, xTitlePad]);

  // The horizontal x-axis carries no auto height band, so its title needs margin.
  const resolvedBottom = (bottomMargin ?? 6) + (horizontal ? xTitlePad : 0);

  // recharts axis-title config (the `label` prop). Kept undefined when no title is
  // set so the axis renders exactly as before.
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

  const r = barRadius;
  const radiusArr: [number, number, number, number] = horizontal
    ? [0, r, r, 0]
    : [r, r, 0, 0];

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
              top: 8,
              right: showValues ? 36 : 8,
              left: (horizontal ? 8 : 0) + yTitlePad,
              bottom: resolvedBottom,
            }}
          >
            {showGrid ? (
              <CartesianGrid
                vertical={false}
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
                  width={100 + yTitlePad}
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

            <Bar
              dataKey="value"
              fill={barColor}
              fillOpacity={barOpacity}
              radius={radiusArr}
              isAnimationActive={animationMs > 0}
              animationDuration={animationMs}
              activeBar={hoverColor ? { fill: hoverColor, fillOpacity: 1 } : false}
              onClick={clickParam ? handleBarClick : undefined}
              cursor={clickParam ? "pointer" : undefined}
            >
              {showValues ? (
                <LabelList
                  dataKey="value"
                  position={horizontal ? "right" : "top"}
                  formatter={
                    ((v: unknown) => compactTick(Number(v ?? 0))) as never
                  }
                  style={{ fontSize: 11 }}
                />
              ) : null}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Card title={title} className="ofw-card--chart" style={parseStyle(styleProp)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: BarChartWidget,
    props: barChartProps,
    description:
      "Bar chart powered by a DuckDB SQL query; the query must return 'label' and 'value' columns. Set clickParam to write the clicked bar's label (a scalar) to a param — usable for in-widget drill-down via $param and reported in session feedback.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
