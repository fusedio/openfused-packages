// widgets/line-chart.tsx — line/area chart (recharts) bound to a DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/line-chart.tsx): the prop contract here is a strict SUBSET of the
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
//   • app-only presentation knobs (lineWidth, lineOpacity, dotSize,
//     activeDotSize, areaOpacity, rotateLabels, xAxisFontSize, yAxisFontSize,
//     bottomMargin, beginAtZero, yMin, yMax, animationMs) are intentionally
//     omitted — a config using them still pastes (extra props are accepted on
//     the app side) but they are no-ops here. This is an allowed subset.
//
// Data convention (adopted from the app EXACTLY): the query must return a fixed
// `label` + `value` shape (case-insensitive fallback to `Label`, `Value`); an
// optional `series` column (`Series` fallback) pivots the long rows into wide
// format — one line per distinct series value. The column convention is fixed:
// there is NO x/y prop selecting columns. Single-series uses the `value` column
// directly; multi-series renders one Line per series with the auto palette.

import React, { useMemo } from "react";
import { z } from "zod";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
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
// Mirrors the application line-chart prop contract exactly (a subset is allowed;
// every prop below shares the app's name/type/semantics):
//   sql (required), title, lineColor, curveType, showArea, showDots, showGrid,
//   showLegend, + the universal `style` prop folded in from
//   _universal.ts. The X axis column is fixed to `label`; value series come from
//   the `value` column (single) or the `series` pivot (multi) — no x/y props.
export const lineChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label' and 'value' columns. Optional 'series' column for multi-line charts.",
      ),
    title: z
      .string()
      .optional()
      .describe("Chart title displayed above the chart."),
    lineColor: z
      .string()
      .optional()
      .default("#E8FF59")
      .describe(
        "Line color for single-series charts. Ignored when multiple series are present (auto-palette is used). Default is Fused lime yellow (#E8FF59).",
      ),
    colors: z
      .array(z.string())
      .optional()
      .describe(
        "Series/slice color palette (hex strings), used cyclically. Overrides the default palette.",
      ),
    curveType: z
      .enum(["linear", "smooth", "step"])
      .optional()
      .default("smooth")
      .describe(
        'Interpolation curve: "linear" for straight segments, "smooth" for bezier curves, "step" for stepped lines.',
      ),
    showArea: z
      .boolean()
      .optional()
      .default(true)
      .describe("Fill the area under the line with a gradient."),
    showDots: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show data point dots on the line."),
    showGrid: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show subtle grid lines behind the chart."),
    showLegend: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Show legend for multi-series charts. Auto-hidden when there is only one series.",
      ),
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
        "Axis TITLE for the vertical (y) axis — names what the axis represents, e.g. 'Revenue'. Always set this so the chart is self-explaining; separate from the per-tick labels.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type LineChartProps = z.infer<typeof lineChartProps>;

// ------------------------------------------------------------------- helpers
// Ported from the application for parity (these are render behaviour, not props).

/** Auto palette for multi-series lines (single-series uses `lineColor`). */
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

/** curveType prop → recharts interpolation type. Identical to the app. */
const CURVE_MAP = {
  linear: "linear" as const,
  smooth: "monotone" as const,
  step: "stepAfter" as const,
};

/** Lightweight tooltip (app uses shadcn classes; here a plain styled box). */
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
  // Each series renders as BOTH an <Area> (the gradient fill) and a <Line> in the
  // ComposedChart, so recharts hands us the series twice. Dedup by name (keep the
  // first) so the tooltip shows one row per series, not "North 45 North 45".
  const seen = new Set<string>();
  const items = payload.filter((e) => {
    const k = String(e.name ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const multi = items.length > 1;
  return (
    <div className="ofw-chart-tooltip">
      <div className="ofw-chart-tooltip__label">{label}</div>
      {multi ? (
        items.map((entry, i) => (
          <div className="ofw-chart-tooltip__row" key={i}>
            <span
              className="ofw-chart-tooltip__swatch"
              style={{ backgroundColor: entry.color }}
            />
            <span className="ofw-chart-tooltip__name">{entry.name}</span>
            <span className="ofw-chart-tooltip__value">
              {Number(entry.value).toLocaleString()}
            </span>
          </div>
        ))
      ) : (
        <div className="ofw-chart-tooltip__value">
          {Number(items[0].value).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- component
function LineChartWidget({ element }: ComponentRenderProps<LineChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    lineColor = "#E8FF59",
    colors,
    curveType = "smooth",
    showArea = true,
    showDots = false,
    showGrid = true,
    showLegend = true,
    xAxisLabel,
    yAxisLabel,
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

  // Pivot rows into { label, seriesA: val, seriesB: val, ... } format. Adopts
  // the app's fixed-column convention: label + value (+ optional series). The
  // presence of a `series`/`Series` column triggers the wide-format pivot;
  // otherwise the single `value` column is used directly.
  const { chartData, seriesKeys } = useMemo<{
    chartData: Record<string, unknown>[];
    seriesKeys: string[];
  }>(() => {
    if (!rows || rows.length === 0) return { chartData: [], seriesKeys: [] };

    const get = (row: unknown, ...keys: string[]) => {
      const r = row as Record<string, unknown>;
      for (const k of keys) {
        if (r[k] != null) return r[k];
      }
      return undefined;
    };

    const hasSeries = rows.some((r) => get(r, "series", "Series") != null);

    if (!hasSeries) {
      const data = rows.map((row) => ({
        label: String(get(row, "label", "Label") ?? ""),
        value: Number(get(row, "value", "Value") ?? 0),
      }));
      return { chartData: data, seriesKeys: ["value"] };
    }

    // Multi-series: pivot the long rows into wide format keyed by `label`.
    const labelOrder: string[] = [];
    const labelSet = new Set<string>();
    const seriesSet = new Set<string>();
    const map = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const label = String(get(row, "label", "Label") ?? "");
      const series = String(get(row, "series", "Series") ?? "");
      const value = Number(get(row, "value", "Value") ?? 0);

      seriesSet.add(series);

      if (!labelSet.has(label)) {
        labelSet.add(label);
        labelOrder.push(label);
      }

      if (!map.has(label)) map.set(label, {});
      map.get(label)![series] = value;
    }

    const keys = Array.from(seriesSet);
    const data = labelOrder.map((label) => {
      const entry: Record<string, unknown> = { label };
      const vals = map.get(label) ?? {};
      for (const k of keys) entry[k] = vals[k] ?? 0;
      return entry;
    });

    return { chartData: data, seriesKeys: keys };
  }, [rows]);

  const multiSeries = seriesKeys.length > 1;
  const curve = CURVE_MAP[curveType];
  const palette =
    Array.isArray(colors) && colors.length > 0 ? colors : SERIES_PALETTE;

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
      <div className="ofw-chart ofw-chart--line">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 12, left: yTitlePad, bottom: 6 + xTitlePad }}
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
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              height={30 + xTitlePad}
              label={xTitle}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={55 + yTitlePad}
              tickFormatter={compactTick}
              label={yTitle}
            />

            <Tooltip
              cursor={{ strokeOpacity: 0.3 }}
              content={<ChartTooltip />}
              allowEscapeViewBox={{ x: false, y: true }}
              animationDuration={0}
            />

            {multiSeries && showLegend ? (
              <Legend
                verticalAlign="top"
                height={28}
                iconType="plainline"
                wrapperStyle={{ fontSize: 11 }}
              />
            ) : null}

            {seriesKeys.map((key, i) => {
              const color = multiSeries
                ? palette[i % palette.length]
                : colors?.[0] ?? lineColor;

              return (
                <React.Fragment key={key}>
                  {showArea ? (
                    <defs>
                      <linearGradient
                        id={`ofw-area-grad-${i}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                  ) : null}
                  {showArea ? (
                    <Area
                      type={curve}
                      dataKey={key}
                      stroke="none"
                      fill={`url(#ofw-area-grad-${i})`}
                      isAnimationActive={false}
                      tooltipType="none"
                      legendType="none"
                    />
                  ) : null}
                  <Line
                    type={curve}
                    dataKey={key}
                    name={multiSeries ? key : title || "value"}
                    stroke={color}
                    strokeWidth={2}
                    dot={showDots ? { r: 3, fill: color } : false}
                    activeDot={{ r: 5, fill: color }}
                    isAnimationActive={false}
                  />
                </React.Fragment>
              );
            })}
          </ComposedChart>
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
    component: LineChartWidget,
    props: lineChartProps,
    description:
      "Line/area chart powered by a DuckDB SQL query; the query must return 'label' and 'value' columns, plus an optional 'series' column for multiple lines.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
