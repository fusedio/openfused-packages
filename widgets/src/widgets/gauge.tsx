// widgets/gauge.tsx — radial progress gauge rendered as a CUSTOM SVG arc (NO
// recharts) bound to a DuckDB query (or a static value).
//
// An OpenFused-owned widget (no application-parity constraint — prop names are
// chosen freely, kept lowercase and consistent with the metric/donut siblings).
// Authored ONLY against `@fusedio/widget-sdk` + the local helpers: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// resolves its value through `useDuckDbSqlQuery({ sql, queryId })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// PLUS `writesParam: false` (a gauge never writes a param).
//
// Value resolution + formatting are SHARED with the metric widget: `resolveRawValue`
// picks the SQL first-cell (priority) or the static `value` prop, and `formatValue`
// applies the compact/comma/none formatting. The gauge then maps the number onto a
// [min, max] fraction and renders it as a 240° sweep.
//
// The arc itself is hand-rolled SVG (two stroked <path>s sharing geometry): a
// background track + an accent value arc. The value arc's drawn length is the
// fraction of the 240° sweep, expressed via stroke-dasharray/stroke-dashoffset
// against the path's measured length. We FLOOR the drawn fraction at 0.035 for any
// non-zero value so a tiny value still shows a clear rounded sliver hugging the
// start of the track (round linecaps would otherwise collapse it into a detached
// dot or hide it entirely). The center value is an absolutely-positioned overlay
// (mirroring donut-chart's center total) so it does not steal arc geometry.

import React from "react";
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

// Arc geometry — a 240° sweep starting at 210° and ending at -30° (recharts'
// gauge convention), traced CLOCKWISE in SVG user space. SVG y grows downward,
// so a math angle θ maps to (cx + r·cosθ, cy − r·sinθ).
const VIEW = 120; // viewBox is VIEW×VIEW
const CX = VIEW / 2;
const CY = VIEW / 2;
const R = 48; // arc radius inside the box (leaves room for the rounded cap)
const STROKE = Math.round(R * 0.14 * 100) / 100; // ~14% of radius
const START_ANGLE = 210; // degrees (math convention)
const END_ANGLE = -30;
const SWEEP = START_ANGLE - END_ANGLE; // 240° total sweep, traced clockwise
// Arc length of the full 240° sweep (used to scale the value dash).
const ARC_LENGTH = (Math.PI * R * SWEEP) / 180;
// Minimum drawn fraction so a small (but non-zero) value reads as a rounded
// sliver hugging the start, never a detached cap or invisible nub.
const MIN_FRACTION = 0.035;

function polar(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

// Path for the full background sweep. The large-arc-flag is 1 because 240° > 180°;
// the sweep-flag is 1 (clockwise in SVG, which is decreasing math angle).
function fullArcPath(): string {
  const s = polar(START_ANGLE);
  const e = polar(END_ANGLE);
  const largeArc = SWEEP > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${R} ${R} 0 ${largeArc} 1 ${e.x} ${e.y}`;
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

  // The drawn fraction floors at MIN_FRACTION for any non-zero value so a tiny
  // value (e.g. 5%) is a clear rounded sliver, but a true zero stays empty.
  const drawnFraction = pct <= 0 ? 0 : Math.max(pct, MIN_FRACTION);
  const dashOffset = ARC_LENGTH * (1 - drawnFraction);
  const arcD = fullArcPath();

  // A `%`-suffixed value reads as a percentage → render it in the tabular mono
  // font so digits don't jitter and the unit lines up.
  const isPercent = suffix.trim() === "%";

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
    const ariaLabel = `${displayValue}${suffix}${label ? ` ${label}` : ""}`;
    body = (
      <div className="ofw-gauge">
        <div className="ofw-gauge__arc">
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label={`Gauge: ${ariaLabel}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background track — full 240° sweep. */}
            <path
              className="ofw-gauge__track"
              d={arcD}
              fill="none"
              stroke={trackColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
            />
            {/* Value arc — same geometry, drawn for `drawnFraction` of the sweep
                via dasharray/dashoffset. Hidden entirely when the value is 0. */}
            {drawnFraction > 0 ? (
              <path
                className="ofw-gauge__value-arc"
                d={arcD}
                fill="none"
                stroke={color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={ARC_LENGTH}
                strokeDashoffset={dashOffset}
              />
            ) : null}
          </svg>

          {/* Center overlay — absolutely positioned over the ring (like donut's
              center total) so it never steals geometry from the SVG. */}
          <div className="ofw-gauge__center" aria-hidden="true">
            <div
              className={
                isPercent ? "ofw-gauge__value ofw-gauge__value--pct" : "ofw-gauge__value"
              }
            >
              {displayValue}
              {suffix}
            </div>
            {label ? <div className="ofw-gauge__label">{label}</div> : null}
          </div>
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
      "Radial progress gauge — maps a value (static or the first cell of a DuckDB SQL query) onto a [min, max] range and renders it as a custom 240° SVG arc with the formatted value in the center.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
