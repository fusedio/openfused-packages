// widgets/heatmap-chart.tsx — matrix heatmap (custom CSS grid) bound to a
// DuckDB query.
//
// ALIGNED to the Fused application component (client/src/udfrun/json-ui/
// components/heatmap-chart.tsx): the prop contract here is a strict SUBSET of
// the app's with identical names/types/semantics, so a config authored against
// openfused pastes straight into the app. Authored ONLY against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql: props.sql, queryId })`, styles via
// `parseStyle(props.style)`, default-exports `defineComponent({...})` + the
// `writesParam` flag.
//
// There is NO recharts primitive for a matrix heatmap, so this renders a
// SELF-CONTAINED CSS grid using inline styles only (no new ofw-* CSS class):
// distinct `x` values become columns (first-seen order), distinct `y` values
// become rows (first-seen order), and each cell's background is a LINEAR
// interpolation between `lowColor` and `highColor` across the value domain
// (min→max). Case-insensitive fallbacks adopted from the app: x|X, y|Y,
// value|Value (default 0).
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
// SUBSET note: only the value-coloring + value-label props the app shares are
// exposed (lowColor, highColor, showValues); the app's extra layout-sizing
// props are intentionally omitted — never extra.

import React, { useMemo, useState } from "react";
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

// ----------------------------------------------------------------- props schema
// Mirrors the application heatmap-chart prop contract (a subset is allowed;
// every prop below shares the app's name/type/semantics):
//   sql (required), title, showValues, lowColor, highColor,
//   + the universal `style` prop folded in from _universal.ts.
export const heatmapChartProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return 'x', 'y', and 'value' columns.",
      ),
    title: z
      .string()
      .optional()
      .describe("Chart title displayed above the chart."),
    showValues: z
      .boolean()
      .optional()
      .default(false)
      .describe("Show the numeric value inside each cell."),
    lowColor: z
      .string()
      .optional()
      .default("#111827")
      .describe("Color for the minimum value."),
    highColor: z
      .string()
      .optional()
      .default("#E8FF59")
      .describe(
        "Color for the maximum value. Default is Fused lime (#E8FF59).",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type HeatmapChartProps = z.infer<typeof heatmapChartProps>;

// ------------------------------------------------------------------- helpers
// Ported from the application for parity (these are render behaviour, not props).

/** Parse a #rgb / #rrggbb hex string into an [r, g, b] triple. */
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const num = Number.parseInt(value, 16);
  if (Number.isNaN(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Linear interpolation between two hex colors at t∈[0,1]. */
function interpolateColor(low: string, high: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(low);
  const [r2, g2, b2] = hexToRgb(high);
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const b = Math.round(b1 + (b2 - b1) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

const CELL_GAP = 4;
const MIN_CELL_HEIGHT = 28;
const MIN_COLUMN_WIDTH = 52;
const ROW_LABEL_WIDTH = 110;

// -------------------------------------------------------------------- component
function HeatmapChartWidget({
  element,
}: ComponentRenderProps<HeatmapChartProps>) {
  const props = element.props;
  const {
    sql,
    title,
    showValues = false,
    lowColor = "#111827",
    highColor = "#E8FF59",
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

  // Pivot to a matrix: distinct x → columns (first-seen), distinct y → rows
  // (first-seen), value cells keyed by `${y}::${x}`. Track min/max for the
  // color domain. Case-insensitive fallbacks adopted from the app exactly.
  const { xKeys, yKeys, valueMap, min, max } = useMemo(() => {
    if (!rows || rows.length === 0) {
      return {
        xKeys: [] as string[],
        yKeys: [] as string[],
        valueMap: {} as Record<string, number>,
        min: 0,
        max: 0,
      };
    }

    const xOrder: string[] = [];
    const yOrder: string[] = [];
    const xSet = new Set<string>();
    const ySet = new Set<string>();
    const map: Record<string, number> = {};

    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const x = String(row.x ?? row.X ?? "");
      const y = String(row.y ?? row.Y ?? "");
      // Coerce a non-numeric/missing cell to 0 so one dirty value can't poison
      // the min/max domain (→ NaN span → invalid rgb() on every cell).
      const rawValue = Number(row.value ?? row.Value ?? 0);
      const value = Number.isFinite(rawValue) ? rawValue : 0;

      if (!xSet.has(x)) {
        xSet.add(x);
        xOrder.push(x);
      }
      if (!ySet.has(y)) {
        ySet.add(y);
        yOrder.push(y);
      }

      map[`${y}::${x}`] = value;
      minVal = Math.min(minVal, value);
      maxVal = Math.max(maxVal, value);
    }

    return {
      xKeys: xOrder,
      yKeys: yOrder,
      valueMap: map,
      min: Number.isFinite(minVal) ? minVal : 0,
      max: Number.isFinite(maxVal) ? maxVal : 0,
    };
  }, [rows]);

  const span = max - min || 1;
  const columnTemplate = `repeat(${xKeys.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`;

  // A custom hover tooltip (consistent with the recharts widgets, vs. a slow
  // native `title`). Positioned fixed at the cursor so it never clips inside the
  // scroll container. Cleared on leave.
  const [tip, setTip] = useState<{ label: string; value: number; left: number; top: number } | null>(
    null,
  );

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="chart" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else if (xKeys.length === 0 || yKeys.length === 0) {
    body = <EmptyState />;
  } else {
    body = (
      <div
        className="ofw-chart ofw-chart--heatmap"
        style={{ height: "100%", overflow: "auto" }}
      >
        <div style={{ display: "inline-block", minWidth: "100%" }}>
          <div style={{ display: "flex", gap: CELL_GAP }}>
            {/* y-axis row labels */}
            <div style={{ width: ROW_LABEL_WIDTH, flexShrink: 0 }}>
              <div style={{ display: "grid", gap: CELL_GAP }}>
                {yKeys.map((y) => (
                  <div
                    key={y}
                    title={y}
                    style={{
                      minHeight: MIN_CELL_HEIGHT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      paddingRight: 8,
                      fontSize: 11,
                      opacity: 0.7,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {y}
                  </div>
                ))}
              </div>
            </div>

            {/* matrix: column headers + value cells */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: columnTemplate,
                  gap: CELL_GAP,
                  marginBottom: CELL_GAP,
                }}
              >
                {xKeys.map((x) => (
                  <div
                    key={x}
                    title={x}
                    style={{
                      fontSize: 11,
                      opacity: 0.7,
                      textAlign: "center",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {x}
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gap: CELL_GAP }}>
                {yKeys.map((y) => (
                  <div
                    key={y}
                    style={{
                      display: "grid",
                      gridTemplateColumns: columnTemplate,
                      gap: CELL_GAP,
                    }}
                  >
                    {xKeys.map((x) => {
                      const value = valueMap[`${y}::${x}`] ?? 0;
                      const ratio = (value - min) / span;
                      const bg = interpolateColor(lowColor, highColor, ratio);
                      const textColor = ratio > 0.55 ? "#111827" : "#e5e7eb";
                      return (
                        <div
                          key={`${y}-${x}`}
                          data-heatmap-cell
                          onMouseMove={(e) =>
                            setTip({
                              label: `${x}, ${y}`,
                              value,
                              left: e.clientX,
                              top: e.clientY,
                            })
                          }
                          onMouseLeave={() => setTip(null)}
                          style={{
                            backgroundColor: bg,
                            minHeight: MIN_CELL_HEIGHT,
                            borderRadius: 2,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: textColor,
                            cursor: "default",
                          }}
                        >
                          {showValues ? (
                            <span style={{ fontSize: 11, fontWeight: 500 }}>
                              {value.toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* min→max color legend */}
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {min.toLocaleString()}
            </span>
            <div
              style={{
                height: 8,
                flex: 1,
                borderRadius: 9999,
                background: `linear-gradient(90deg, ${lowColor} 0%, ${highColor} 100%)`,
              }}
            />
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {max.toLocaleString()}
            </span>
          </div>

          {tip ? (
            <div
              className="ofw-chart-tooltip"
              style={{
                position: "fixed",
                left: tip.left + 12,
                top: tip.top + 12,
                pointerEvents: "none",
                zIndex: 50,
              }}
            >
              <div className="ofw-chart-tooltip__label">{tip.label}</div>
              <div className="ofw-chart-tooltip__value">{tip.value.toLocaleString()}</div>
            </div>
          ) : null}
        </div>
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
    component: HeatmapChartWidget,
    props: heatmapChartProps,
    description:
      "Matrix heatmap driven by a DuckDB SQL query; the query must return 'x', 'y', and 'value' columns. Each cell is colored by linear interpolation between lowColor and highColor across the value domain.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
