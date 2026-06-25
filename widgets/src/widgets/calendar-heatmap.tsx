// widgets/calendar-heatmap.tsx — a GitHub-style activity grid in pure SVG (NO
// recharts) bound to a DuckDB query.
//
// An OpenFused-owned widget (no app-parity constraint). Authored ONLY against
// `@fusedio/widget-sdk`: it reads `element.props`, declares its props with a
// real-zod `z.object({...}).extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(props.style)`,
// and default-exports `defineComponent({...})` + the `writesParam` flag.
//
// There is no recharts primitive for a calendar grid, so this renders a
// SELF-CONTAINED SVG: `weeks` columns × 7 rows (Sun..Sat), one <rect rx=2> per
// day. The query returns rows with a `date` column (YYYY-MM-DD) and a `value`
// column; we build a date→value map and anchor the grid's LAST column at the
// max date present (or today if the data is empty), walking backwards so the
// most recent week sits on the right (GitHub's convention).
//
// Coloring: each day interpolates lowColor→highColor by value/maxValue.
//   • If BOTH colors are hex, we do the rgb interpolation in JS (a literal fill).
//   • If either color is a CSS var (e.g. the default `var(--ofw-accent)`), the
//     var can't be read in JS, so instead each cell paints a `lowColor` base
//     rect with a `highColor` overlay whose `fill-opacity` ramps 0.12..1 by
//     value/maxValue — letting the browser resolve the var at paint time.
// Empty days render as `lowColor`. Each cell carries a native <title> child for
// a date + value tooltip. The grid lives in an overflow-x:auto wrapper so a wide
// `weeks` count scrolls instead of overflowing the card.

import React, { useMemo } from "react";
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
//   sql (required), title, lowColor, highColor, weeks, cellSize, gap,
//   + the universal `style` prop folded in from _universal.ts.
export const calendarHeatmapProps = z
  .object({
    sql: z
      .string()
      .describe(
        "DuckDB SQL query with {{udf_name}} and $param_name placeholders. Must return a 'date' column (YYYY-MM-DD) and a numeric 'value' column.",
      ),
    title: z.string().optional().describe("Card title displayed above the grid."),
    lowColor: z
      .string()
      .optional()
      .default("rgba(130,160,200,0.06)")
      .describe(
        "Color for empty / zero-value days (the grid background). Default is a faint cool tint so the empty grid reads as a quiet GitHub-style scaffold rather than near-invisible.",
      ),
    highColor: z
      .string()
      .optional()
      .default("var(--ofw-accent)")
      .describe(
        "Color for the maximum-value day. Default is the Fused lime accent. When both colors are hex, days are a JS rgb interpolation low→high; when either is a CSS var, days ramp fill-opacity of highColor instead.",
      ),
    weeks: z
      .number()
      .optional()
      .default(13)
      .describe(
        "Maximum number of week columns to show, counting back from the latest date. The grid frames the actual data span with about a week of padding, so it never shows more than this and often fewer.",
      ),
    cellSize: z
      .number()
      .optional()
      .default(12)
      .describe("Side length of each day square in pixels."),
    gap: z
      .number()
      .optional()
      .default(3)
      .describe("Gap between day squares in pixels."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type CalendarHeatmapProps = z.infer<typeof calendarHeatmapProps>;

// ------------------------------------------------------------------- helpers

/** Is a color literal a hex (#rgb / #rrggbb) we can interpolate in JS? */
function isHex(c: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

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

/** Format a Date as a stable YYYY-MM-DD key (UTC, so a TZ shift can't drift it). */
function toKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD (or parseable) date string to a UTC-midnight Date, or null. */
function parseDate(s: string): Date | null {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// -------------------------------------------------------------------- component
function CalendarHeatmapWidget({
  element,
}: ComponentRenderProps<CalendarHeatmapProps>) {
  const props = element.props;
  const {
    sql,
    title,
    lowColor = "rgba(130,160,200,0.06)",
    highColor = "var(--ofw-accent)",
    weeks = 13,
    cellSize = 12,
    gap = 3,
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

  // Build date→value map (case-insensitive `date`/`value` fallbacks) and track
  // the min + max date present (for the grid anchor and span) and max value (for
  // the color domain). A non-numeric/missing value coerces to 0.
  const { valueMap, minDate, maxDate, maxValue } = useMemo(() => {
    const map: Record<string, number> = {};
    let nDate: Date | null = null;
    let mDate: Date | null = null;
    let mVal = 0;
    if (rows && rows.length > 0) {
      for (const r of rows) {
        const row = r as Record<string, unknown>;
        const rawDate = row.date ?? row.Date ?? "";
        const d = parseDate(String(rawDate));
        if (!d) continue;
        const rawVal = Number(row.value ?? row.Value ?? 0);
        const value = Number.isFinite(rawVal) ? rawVal : 0;
        const key = toKey(d);
        // If a date repeats, sum it (a day's total activity).
        map[key] = (map[key] ?? 0) + value;
        if (mDate === null || d.getTime() > mDate.getTime()) mDate = d;
        if (nDate === null || d.getTime() < nDate.getTime()) nDate = d;
        if (map[key] > mVal) mVal = map[key];
      }
    }
    return { valueMap: map, minDate: nDate, maxDate: mDate, maxValue: mVal };
  }, [rows]);

  // Geometry: the grid ends on the week containing `maxDate` (or today). We pad
  // forward to that week's Saturday so the last column is whole, then walk back
  // a *right-sized* number of columns. Columns are weeks (Sun..Sat top→bottom).
  const grid = useMemo(() => {
    const maxWk = Math.max(1, Math.floor(weeks));
    const anchor = maxDate ?? parseDate(toKey(new Date())) ?? new Date();
    // End of the anchor's week (Saturday): step forward to day-of-week 6.
    const endCol = new Date(anchor.getTime());
    endCol.setUTCDate(endCol.getUTCDate() + (6 - endCol.getUTCDay()));

    // Right-size the window: frame the actual data span (minDate→maxDate) with
    // ~1 week of padding instead of a long empty desert. We count whole week
    // columns from the Saturday of maxDate's week back to the Sunday of
    // minDate's week, then add one padding column — capped at the `weeks` max.
    // With no data, fall back to the full `weeks` window ending today.
    let wk = maxWk;
    if (minDate && maxDate) {
      const startWeekSun = new Date(minDate.getTime());
      startWeekSun.setUTCDate(startWeekSun.getUTCDate() - startWeekSun.getUTCDay());
      const spanWeeks = Math.round((endCol.getTime() - startWeekSun.getTime()) / (7 * DAY_MS));
      wk = Math.max(1, Math.min(maxWk, spanWeeks + 1));
    }

    // Start = Sunday of the column (wk-1) weeks before the end column.
    const start = new Date(endCol.getTime() - ((wk - 1) * 7 + 6) * DAY_MS);

    const columns: Array<Array<{ key: string; date: Date }>> = [];
    const monthTicks: Array<{ col: number; label: string }> = [];
    let lastMonth = -1;
    let lastTickCol = -99;
    for (let c = 0; c < wk; c++) {
      const col: Array<{ key: string; date: Date }> = [];
      for (let row = 0; row < 7; row++) {
        const date = new Date(start.getTime() + (c * 7 + row) * DAY_MS);
        col.push({ key: toKey(date), date });
      }
      // Month label on a column whose first day rolls into a new month — but
      // skip it when the previous label is < 3 columns back so adjacent month
      // names (e.g. a partial first month + the next) never overprint.
      const firstMonth = col[0].date.getUTCMonth();
      if (firstMonth !== lastMonth) {
        if (c - lastTickCol >= 3) {
          monthTicks.push({ col: c, label: MONTH_LABELS[firstMonth] });
          lastTickCol = c;
        }
        lastMonth = firstMonth;
      }
      columns.push(col);
    }
    return { columns, monthTicks, wk };
  }, [minDate, maxDate, weeks]);

  const cell = Math.max(4, cellSize);
  const g = Math.max(0, gap);
  const step = cell + g;
  const topPad = 16; // room for month labels
  const leftPad = 26; // gutter for weekday row labels (Mon/Wed/Fri)
  const bottomPad = 18; // room for the Less→More legend
  const gridW = grid.wk * step - g;
  const gridH = 7 * step - g;
  const svgWidth = leftPad + gridW;
  const svgHeight = topPad + gridH + bottomPad;

  // Color resolution: literal hex pair → JS rgb interpolation; otherwise an
  // opacity ramp of highColor over a lowColor base (the browser resolves the var).
  const bothHex = isHex(lowColor) && isHex(highColor);
  const span = maxValue || 1;

  // Weekday row labels: only odd rows (Mon=1, Wed=3, Fri=5) like GitHub, so the
  // gutter stays sparse and readable.
  const weekdayLabels: Array<{ row: number; label: string }> = [
    { row: 1, label: "Mon" },
    { row: 3, label: "Wed" },
    { row: 5, label: "Fri" },
  ];

  // Legend swatches share the cell coloring paths exactly: hex pair → rgb
  // interpolation; otherwise lowColor base + highColor opacity ramp.
  const legendStops = [0, 0.25, 0.5, 0.75, 1];
  const legendSwatch = (t: number) =>
    bothHex
      ? interpolateColor(lowColor, highColor, t)
      : lowColor;
  const legendCell = Math.max(8, cell);
  const legendW = legendStops.length * (legendCell + 2) - 2;

  let body: React.ReactNode;

  if (!sql) {
    body = <EmptyState label="No query" />;
  } else if (loading && rows.length === 0) {
    body = <SkeletonState variant="chart" />;
  } else if (error) {
    body = <ErrorState message={error} />;
  } else {
    // NOTE: an empty result still renders the (all-empty) grid rather than an
    // EmptyState — the calendar frame anchored at today is itself informative.
    body = (
      <div className="ofw-cal-heatmap__scroll">
        <svg
          className="ofw-cal-heatmap__svg"
          width={svgWidth}
          height={svgHeight}
          role="img"
          aria-label={title ?? "Calendar heatmap"}
        >
          {/* month labels */}
          {grid.monthTicks.map((t) => (
            <text
              key={`m-${t.col}`}
              className="ofw-cal-heatmap__month"
              x={leftPad + t.col * step}
              y={10}
            >
              {t.label}
            </text>
          ))}
          {/* weekday row labels (Mon/Wed/Fri) in a faint mono gutter */}
          {weekdayLabels.map((w) => (
            <text
              key={`w-${w.row}`}
              className="ofw-cal-heatmap__weekday"
              x={leftPad - 6}
              y={topPad + w.row * step + cell - 2}
              textAnchor="end"
            >
              {w.label}
            </text>
          ))}
          {/* day cells */}
          {grid.columns.map((col, c) =>
            col.map((d, row) => {
              const value = valueMap[d.key] ?? 0;
              const ratio = value / span;
              const x = leftPad + c * step;
              const y = topPad + row * step;
              const tooltip = `${d.key}: ${value.toLocaleString()}`;
              if (bothHex) {
                const fill =
                  value > 0
                    ? interpolateColor(lowColor, highColor, ratio)
                    : lowColor;
                return (
                  <rect
                    key={d.key}
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    rx={2}
                    fill={fill}
                  >
                    <title>{tooltip}</title>
                  </rect>
                );
              }
              // CSS-var path: lowColor base + highColor overlay at ramped opacity.
              const opacity =
                value > 0 ? 0.12 + 0.88 * Math.min(1, ratio) : 0;
              return (
                <g key={d.key}>
                  <rect
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    rx={2}
                    fill={lowColor}
                  />
                  {opacity > 0 ? (
                    <rect
                      x={x}
                      y={y}
                      width={cell}
                      height={cell}
                      rx={2}
                      fill={highColor}
                      fillOpacity={opacity}
                    />
                  ) : null}
                  <rect
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    rx={2}
                    fill="transparent"
                  >
                    <title>{tooltip}</title>
                  </rect>
                </g>
              );
            }),
          )}
          {/* Less → More legend, bottom-right, sharing the cell color ramp */}
          {(() => {
            const legendY = topPad + gridH + bottomPad - legendCell;
            const moreX = svgWidth;
            const swatchesRight = moreX - 30; // room for the "More" label
            const swatchesLeft = swatchesRight - legendW;
            const lessX = swatchesLeft - 4;
            const textY = legendY + legendCell - 1;
            return (
              <g aria-hidden="true">
                <text
                  className="ofw-cal-heatmap__legend"
                  x={lessX}
                  y={textY}
                  textAnchor="end"
                >
                  Less
                </text>
                {legendStops.map((t, i) => {
                  const sx = swatchesLeft + i * (legendCell + 2);
                  const op = 0.12 + 0.88 * t;
                  if (bothHex) {
                    return (
                      <rect
                        key={`lg-${i}`}
                        x={sx}
                        y={legendY}
                        width={legendCell}
                        height={legendCell}
                        rx={2}
                        fill={legendSwatch(t)}
                      />
                    );
                  }
                  return (
                    <g key={`lg-${i}`}>
                      <rect
                        x={sx}
                        y={legendY}
                        width={legendCell}
                        height={legendCell}
                        rx={2}
                        fill={lowColor}
                      />
                      {t > 0 ? (
                        <rect
                          x={sx}
                          y={legendY}
                          width={legendCell}
                          height={legendCell}
                          rx={2}
                          fill={highColor}
                          fillOpacity={op}
                        />
                      ) : null}
                    </g>
                  );
                })}
                <text
                  className="ofw-cal-heatmap__legend"
                  x={moreX}
                  y={textY}
                  textAnchor="end"
                >
                  More
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    );
  }

  return (
    <Card
      title={title}
      className="ofw-card--chart ofw-card--heatmap"
      style={parseStyle(styleProp)}
    >
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: CalendarHeatmapWidget,
    props: calendarHeatmapProps,
    description:
      "GitHub-style calendar activity grid (pure SVG) driven by a DuckDB SQL query; the query must return a 'date' (YYYY-MM-DD) and a numeric 'value' column. The grid ends on the latest date present (or today) and shows `weeks` columns × 7 rows, each day colored by value/maxValue between lowColor and highColor.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
