// widgets/donut-chart.tsx — donut chart (recharts) bound to a DuckDB query.
//
// RENAME of the legacy openfused `pie-chart` widget, realigned to the
// application's `donut-chart` component
// (application/client/src/udfrun/json-ui/components/donut-chart.tsx) so a config
// authored here pastes straight into the Fused application. The declared prop
// set is a strict SUBSET of the app's DonutChartPropsSchema — IDENTICAL prop
// NAMES / TYPES / SEMANTICS, never an openfused-only prop.
//
// Authored ONLY against `@fusedio/widget-sdk` + openfused primitives: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds rows via `useDuckDbSqlQuery({ sql, queryId })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// PLUS `writesParam: false` (a chart never writes a param).
//
// Prop contract changes from the legacy openfused pie-chart, per the alignment
// map (app == application/.../donut-chart.tsx):
//   • `query`  -> `sql`            (universal query -> sql rename; SQL STRING
//                                   contents/grammar owned by another agent —
//                                   only the prop KEY changes here)
//   • `css`    -> `style`          (universal css -> style rename; the universal
//                                   `style` lands in ./_universal.ts globally, so
//                                   this file reads it off `element.props.style`
//                                   and MUST NOT redeclare it)
//   • REMOVE `x` / `y`             (app has no slice-name / slice-value column
//                                   props — columns are FIXED to `label`/`value`)
//   • REMOVE `height`              (app sizes via a flex container, not a px
//                                   height — openfused sizes via ResponsiveContainer)
//   • REMOVE `donut` (boolean)     (the donut hole is now driven by `innerRadius`
//                                   in px; default 56 already cuts a hole)
//   • ADD `innerRadius` / `outerRadius` (px numbers, app prop)
//   • ADD `showLegend` / `showLabels` / `showCenterTotal` (app booleans)
//   • ADD `animationMs`            (app prop; 0 disables animation)
//
// Column convention now matches the app exactly: read FIXED `label` + `value`
// columns (tolerating capitalized `Label`/`Value` fallbacks as the app does),
// dropping the old columns[0]/columns[1] nameKey/valueKey inference that backed
// x/y.
//
// The app uses baseui Theme, GlassLoadingOverlay, shadcn/Tailwind classNames and
// a custom ChartTooltip — NONE of which are imported here. The same config
// semantics are reproduced with openfused's lightweight primitives:
// Card / LoadingState / ErrorState / EmptyState, plain HTML + `ofw-*`
// classNames, recharts Pie/Cell/Tooltip/ResponsiveContainer, parseStyle.
// Identical rendering is NOT required — identical CONFIG semantics IS.

import React from "react";
import { z } from "zod";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
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
// A strict subset of the application's DonutChartPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in
// via `.extend(UNIVERSAL_PROPS.shape)`. The app's zod `.default()`s (56/88/true/
// false/true/300) are mirrored here AND re-applied as JS fallbacks in the
// destructure below, because at render time openfused's zod is stubbed and does
// not apply defaults at runtime (the app destructure does the same).
export const donutChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'label' and 'value' columns.",
      ),
    title: z.string().optional().describe("Chart title displayed above"),
    colors: z
      .array(z.string())
      .optional()
      .describe(
        "Series/slice color palette (hex strings), used cyclically. Overrides the default palette.",
      ),
    innerRadius: z
      .number()
      .optional()
      .default(56)
      .describe("Inner radius in pixels (donut hole size)."),
    outerRadius: z
      .number()
      .optional()
      .default(88)
      .describe("Outer radius in pixels."),
    showLegend: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show category legend."),
    showLabels: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show percentage labels on slices."),
    showCenterTotal: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show total value text in donut center."),
    animationMs: z
      .number()
      .optional()
      .default(300)
      .describe(
        "Animation duration in milliseconds. 0 disables animation. Animation only plays on data changes, not on zoom/resize.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type DonutChartProps = z.infer<typeof donutChartProps>;

// ------------------------------------------------------ palette / tooltip styling
// Read the palette from CSS custom properties so charts re-theme with the design
// system. Resolved lazily on the client (document is available in the browser).
// openfused keeps its own --ofw-series-* palette; rendering need not match the
// app's SERIES_PALETTE — only the CONFIG semantics (per-slice coloring) do.
const FALLBACK_PALETTE = [
  "#5eead4",
  "#818cf8",
  "#fbbf24",
  "#f472b6",
  "#34d399",
  "#60a5fa",
  "#f87171",
  "#a78bfa",
];

function readPalette(): string[] {
  if (typeof document === "undefined") return FALLBACK_PALETTE;
  const styles = getComputedStyle(document.documentElement);
  const colors: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = styles.getPropertyValue(`--ofw-series-${i}`).trim();
    if (v) colors.push(v);
  }
  return colors.length ? colors : FALLBACK_PALETTE;
}

// A donut slice as the app derives it: fixed label/value columns.
interface DonutSlice {
  label: string;
  value: number;
}

// ------------------------------------------------------------------- legend
// Per-row legend geometry. The widget can NOT rely on a `.ofw-chart__legend`
// CSS rule (none exists in widget.css — only `.ofw-chart` is defined), so the
// row layout is computed here and applied inline. Each row gets its own
// `top = index * rowHeight`, guaranteeing the labels sit on separate,
// non-overlapping baselines instead of collapsing onto the same line.
export const LEGEND_ROW_HEIGHT = 18;

export interface LegendRow {
  label: string;
  color: string;
  /** Vertical offset (px) of this row's top edge within the legend block. */
  top: number;
}

/** Pure: lay legend entries out as contiguous, non-overlapping rows. */
export function legendRowLayout(
  entries: { label: string }[],
  palette: string[],
  rowHeight: number = LEGEND_ROW_HEIGHT,
): LegendRow[] {
  return entries.map((entry, i) => ({
    label: entry.label,
    color: palette[i % palette.length],
    top: i * rowHeight,
  }));
}

// -------------------------------------------------------------------- component
function DonutChartWidget({ element }: ComponentRenderProps<DonutChartProps>) {
  // App-equivalent destructure: mirror the zod `.default()`s as JS fallbacks
  // because the render-time zod stub does not apply defaults.
  const {
    sql,
    title,
    colors,
    innerRadius = 56,
    outerRadius = 88,
    showLegend = true,
    showLabels = false,
    showCenterTotal = true,
    animationMs = 300,
  } = element.props;
  // `style` is the universal prop (lives in ./_universal.ts via the global
  // css -> style migration); read it off element.props without redeclaring it.
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
    // App column convention: FIXED `label`/`value` (tolerate capitalized
    // `Label`/`Value`). No x/y/nameKey/valueKey column-selection props.
    const chartData: DonutSlice[] = (rows as Record<string, unknown>[]).map(
      (row) => ({
        label: String(row.label ?? row.Label ?? ""),
        value: Number(row.value ?? row.Value ?? 0),
      }),
    );
    const total = chartData.reduce((sum, row) => sum + Number(row.value), 0);
    const palette =
      Array.isArray(colors) && colors.length > 0 ? colors : readPalette();

    body = (
      <div
        className="ofw-chart ofw-chart--donut"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          minHeight: 0,
        }}
      >
        {/* Chart area: flex-1 so the donut fills the body; the center-total
            overlay is absolutely positioned over THIS region only (not the
            legend), mirroring the app's flex-1 chart + shrink-0 legend split. */}
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                startAngle={90}
                endAngle={-270}
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={1}
                stroke="none"
                label={
                  showLabels
                    ? ({ percent }: { percent?: number }) =>
                        percent != null && percent >= 0.05
                          ? `${(percent * 100).toFixed(0)}%`
                          : ""
                    : false
                }
                isAnimationActive={animationMs > 0}
                animationDuration={animationMs}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {showCenterTotal && chartData.length > 0 ? (
            // Absolutely centered over the ring. No `.ofw-chart__center` CSS
            // rule exists, so the positioning is inline — otherwise this block
            // falls into normal flow below the chart, stealing height from the
            // ResponsiveContainer and clipping the donut into broken arcs.
            <div
              className="ofw-chart__center"
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                pointerEvents: "none",
                lineHeight: 1.2,
              }}
            >
              <div
                className="ofw-chart__center-label"
                style={{ fontSize: 11, opacity: 0.7 }}
              >
                Total
              </div>
              <div
                className="ofw-chart__center-value"
                style={{ fontSize: 18, fontWeight: 600 }}
              >
                {total.toLocaleString()}
              </div>
            </div>
          ) : null}
        </div>

        {showLegend && chartData.length > 0 ? (
          // No `.ofw-chart__legend*` CSS rules exist (widget.css defines only
          // `.ofw-chart`), so the row layout is applied inline here. Each item
          // is a flex row with a fixed line-height equal to LEGEND_ROW_HEIGHT;
          // without it the swatch and label collapse onto one baseline and
          // adjacent rows paint on top of each other ("NPR" over "…al").
          <div
            className="ofw-chart__legend"
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 0,
              paddingTop: 6,
              overflowY: "auto",
              fontSize: 12,
            }}
          >
            {chartData.map((entry, i) => (
              <div
                key={entry.label || i}
                className="ofw-chart__legend-item"
                title={`${entry.label}: ${entry.value.toLocaleString()}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: LEGEND_ROW_HEIGHT,
                  lineHeight: `${LEGEND_ROW_HEIGHT}px`,
                  minWidth: 0,
                }}
              >
                <span
                  className="ofw-chart__legend-swatch"
                  style={{
                    flexShrink: 0,
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: palette[i % palette.length],
                  }}
                />
                <span
                  className="ofw-chart__legend-label"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}
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
    component: DonutChartWidget,
    props: donutChartProps,
    description: "Donut chart driven by DuckDB SQL query.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
