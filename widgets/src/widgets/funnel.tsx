// widgets/funnel.tsx — conversion funnel bound to a DuckDB query.
//
// An OpenFused-owned chart widget (no app-parity constraint): prop names are
// chosen freely but kept lowercase and consistent with the sibling charts
// (bar-chart / donut-chart). Authored ONLY against `@fusedio/widget-sdk` + the
// local helpers: it reads `element.props`, declares its props with real-zod
// `z.object({...}).extend(UNIVERSAL_PROPS.shape)`, binds rows via
// `useDuckDbSqlQuery({ sql, queryId })`, styles via `parseStyle(...)`, and
// default-exports `defineComponent({...})` PLUS `writesParam: false` (a chart
// never writes a param).
//
// Data convention (matching bar-chart / donut-chart): the query returns FIXED
// `label` + `value` columns (tolerating capitalized `Label`/`Value`), with rows
// already in descending order. We sort descending defensively so the funnel
// narrows top→bottom regardless of query order.
//
// Render model: a custom CSS flex COLUMN of stage rows (NO recharts). Each row
// is a two-column read — a fixed left gutter holds the stage label, then a band
// track holds a centered rounded bar whose WIDTH is min-width-floored at 18% so
// the smallest stage is always a legible band, never a thread. The bar fades in
// opacity from the top stage (solid) to the deepest (0.35). The value+percent
// sits on one line inside the bar; when the bar is too narrow to hold it the
// text falls back to the right gutter. Each band carries a native `title` with
// the exact value for hover.

import React from "react";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { z } from "zod";
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
        "Base fill color for the funnel bands. Each stage steps down in opacity of this color (top stage solid, deepest stage faintest). Default is the lime accent.",
      ),
    showValues: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show the numeric value on each stage."),
    showPercent: z
      .boolean()
      .optional()
      .default(true)
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

/** Exact value for the native hover title (grouped thousands, no rounding). */
function exactValue(v: number): string {
  return Number.isFinite(v) ? v.toLocaleString("en-US") : String(v);
}

// Min-width floor: the smallest stage is guaranteed a readable band of this
// fraction of the track, never a thread.
const WIDTH_FLOOR = 0.18;
// Below this many px a band can't hold the centered value legibly, so the
// value/percent text moves to the right gutter instead.
const INLINE_MIN_PX = 64;

// A funnel stage, plus the derived fade opacity, band width fraction, and the
// formatted value/percent text.
interface FunnelStage {
  label: string;
  value: number;
  opacity: number;
  widthPct: number;
  valueLabel: string;
  titleText: string;
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
    showPercent = true,
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

  // Measure the band-track width so we can decide, per row, whether the bar is
  // wide enough to carry its value inline or must spill into the right gutter.
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [trackPx, setTrackPx] = React.useState(0);
  React.useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setTrackPx(w);
    });
    ro.observe(el);
    setTrackPx(el.clientWidth);
    return () => ro.disconnect();
  }, [rows.length]);

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

    // Per stage: a fade stepping down in opacity from 1 (top) to a floor of
    // 0.35 (deepest) so the funnel reads as one hue darkening top→bottom; a
    // min-width-floored band width = (0.18 + 0.82 * value/top); and the
    // value/percent text on one line.
    const data: FunnelStage[] = stages.map((s, i) => {
      const t = last > 0 ? i / last : 0; // 0 at top → 1 at bottom
      const opacity = 1 - t * 0.65; // 1 → 0.35
      const frac = top > 0 ? s.value / top : 0;
      const widthPct = (WIDTH_FLOOR + 0.82 * frac) * 100;
      const pct = top > 0 ? Math.round((s.value / top) * 100) : 0;
      const parts: string[] = [];
      if (showValues) parts.push(compactValue(s.value));
      if (showPercent) parts.push(`${pct}%`);
      const valueLabel = parts.join("  ·  ");
      return {
        label: s.label,
        value: s.value,
        opacity,
        widthPct,
        valueLabel,
        titleText: `${s.label}: ${exactValue(s.value)} (${pct}%)`,
      };
    });

    body = (
      <div
        className="ofw-funnel"
        role="img"
        aria-label={`Funnel chart with ${data.length} stages${
          title ? `: ${title}` : ""
        }`}
      >
        {data.map((stage, i) => {
          // Decide inline vs. gutter placement from the measured band-track px.
          // Until the track is measured (first paint / no ResizeObserver) we
          // optimistically render inline; the effect re-renders with the real
          // width on the next frame.
          const barPx = trackPx > 0 ? (trackPx * stage.widthPct) / 100 : Infinity;
          const inline = !stage.valueLabel || barPx >= INLINE_MIN_PX;
          const isTop = i === 0;
          return (
            <div className="ofw-funnel__row" key={`${stage.label}-${i}`}>
              <span className="ofw-funnel__label" title={stage.label}>
                {stage.label}
              </span>
              <div className="ofw-funnel__track" ref={i === 0 ? trackRef : null}>
                <div
                  className={`ofw-funnel__bar${
                    isTop ? " ofw-funnel__bar--top" : ""
                  }`}
                  style={{
                    width: `${stage.widthPct}%`,
                    background: color,
                    opacity: stage.opacity,
                  }}
                  title={stage.titleText}
                >
                  {inline && stage.valueLabel ? (
                    <span className="ofw-funnel__value ofw-funnel__value--in">
                      {stage.valueLabel}
                    </span>
                  ) : null}
                </div>
                {!inline && stage.valueLabel ? (
                  <span className="ofw-funnel__value ofw-funnel__value--out">
                    {stage.valueLabel}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card title={title} className="ofw-card--chart ofw-card--funnel" style={parseStyle(style)}>
      {body}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: FunnelWidget,
    props: funnelProps,
    description:
      "Conversion funnel powered by a DuckDB SQL query; the query must return 'label' and 'value' columns in descending order. Each stage is a min-width-floored band that fades to a lower opacity of `color`. Toggle per-stage value and percent-of-top labels via showValues / showPercent.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
