// widgets/metric.tsx — dashboard metric card with a single formatted value.
//
// RENAME of the former `stat` component, aligned to the application's `metric`
// json-ui component (../../../../application/client/src/udfrun/json-ui/components/metric.tsx).
// The openfused prop contract is a strict SUBSET of the app's: identical prop
// NAMES, types and semantics, with FEWER props implemented than the app where a
// feature depends on machinery outside openfused's lightweight surface.
//
// Authored ONLY against `@fusedio/widget-sdk`: it reads `element.props`,
// declares its props with a real-zod `z.object({...}).extend(UNIVERSAL_PROPS.shape)`,
// binds data through `useDuckDbSqlQuery({ sql, queryId })`, styles via
// `parseStyle(...)`, and default-exports a `defineComponent({...})` plus the
// `writesParam: false` flag the generator reads.
//
// Alignment notes vs. the old `stat`:
//   • prop RENAME query → sql (the DuckDB SQL prop); the {{ref}}/$param SQL string
//     itself is owned by another agent and untouched.
//   • value RETYPE: stat's union(string|number|boolean|null) → z.string() to match
//     the app's `value: z.string()` exactly (lossy — authors stringify literals).
//   • format RETYPE: stat's [number,percent,currency,raw] → the app's
//     [compact,comma,none] (default "compact"); same prop NAME, app's semantics.
//   • ADD prefix, suffix, decimals, size, color — all present in the app contract.
//   • formatters replaced by the app's formatCompact (B/M/K) + formatComma +
//     "none" passthrough, via formatValue(raw, fmt, decimals).
//   • value resolution priority matches the app: sql (first column of the first
//     row) wins when it returns rows; otherwise the static `value` prop is used.
//   • Empty/null first cell renders as "" (app convention), NOT stat's em-dash.
//
// SUBSET DECISIONS (deliberate omissions that do not change CONFIG semantics):
//   • No `useParamSubstitution` on `value` ($param-in-value): that hook is outside
//     this task's permitted import set and the $param grammar is owned by another
//     agent. The prop name/type still match the app.
//   • No auto-shrink (useAutoShrink / ResizeObserver / canvas measureText) and no
//     baseui Theme: those are presentation-only; openfused renders with plain HTML
//     + ofw-* classNames and applies `size` as a fixed font-size.
//
// `queryId` is read off `element.props._queryId` (the resolver-stamped binding
// id) and threaded into the hook (belt-and-suspenders alongside JsonUiBindingContext).
//
// UNIVERSAL-RENAME COUPLING: the universal inline-style prop is read off whatever
// key UNIVERSAL_PROPS currently exposes. _universal.ts declares `style` (the
// css→style universal rename has landed), so this file reads
// `element.props.style` in lockstep with the other widgets.

import { z } from "zod";
import {
  useDuckDbSqlQuery,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, SkeletonState } from "../components/card";

// ----------------------------------------------------------------- props schema
// Mirrors the application `metric` component's prop set (a strict subset):
//   value, sql, label, prefix, suffix, format, decimals, size, color,
//   + the universal `style` prop folded in once via UNIVERSAL_PROPS.shape.
export const metricProps = z
  .object({
    value: z
      .string()
      .optional()
      .default("")
      .describe("Static value to display when no sql is given."),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL with {{udf_name}} and $param_name placeholders. Returns first column of first row (highest priority over value).",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text shown below the number."),
    prefix: z
      .string()
      .optional()
      .default("")
      .describe('Text prepended before the formatted number (e.g. "$").'),
    suffix: z
      .string()
      .optional()
      .default("")
      .describe('Text appended after the formatted number (e.g. "%", " km²").'),
    format: z
      .enum(["compact", "comma", "none"])
      .optional()
      .default("compact")
      .describe(
        'How to format the number. "compact" abbreviates large values (e.g. 1.2M, 45.3K, 2.5B). "comma" adds thousand separators (e.g. 1,234,567). "none" displays the raw value as-is.',
      ),
    decimals: z
      .number()
      .optional()
      .default(1)
      .describe("Number of decimal places used by compact/comma formatting."),
    size: z
      .number()
      .optional()
      .default(36)
      .describe("Font size of the number in pixels. Default 36."),
    color: z
      .string()
      .optional()
      .describe("Accent color for the number; inherits theme when absent."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type MetricProps = z.infer<typeof metricProps>;

// ------------------------------------------------------------------ formatting
// Ported from the application's metric.tsx so the formatted output matches.
function formatCompact(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000)
    return `${sign}${(abs / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(abs % 1 === 0 ? 0 : decimals)}`;
}

function formatComma(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatValue(
  raw: string,
  fmt: "compact" | "comma" | "none",
  decimals: number,
): string {
  if (fmt === "none") return raw;
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  if (fmt === "compact") return formatCompact(n, decimals);
  return formatComma(n, decimals);
}

// --------------------------------------------------------------- value read
/**
 * Resolve the raw (pre-format) string the metric displays.
 *
 * Priority matches the app: a `sql` result (first column of the first row) wins
 * when rows are present; otherwise the static `value`. The first column is the
 * resolver-provided `columns[0]` (the authoritative SQL column order — for an
 * aggregate that name is the expression text, e.g. `COUNT(*)` /
 * `ROUND(AVG(coverage),1)`), falling back to `Object.keys(firstRow)[0]` only
 * when columns are absent. This mirrors the working `text` sibling; reading
 * `Object.keys(firstRow)[0]` alone is fragile (object key order is not the SQL
 * column order when a key is integer-like). An empty/null first cell → `""`.
 */
export function resolveRawValue(
  sql: string | undefined,
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
  value: string,
): string {
  if (sql && rows.length > 0) {
    const firstRow = rows[0];
    const firstKey = columns[0] ?? Object.keys(firstRow)[0];
    const cell = firstKey !== undefined ? firstRow[firstKey] : undefined;
    return cell !== null && cell !== undefined ? String(cell) : "";
  }
  return value;
}

// -------------------------------------------------------------------- component
function Metric({ element }: ComponentRenderProps<MetricProps>) {
  const {
    value = "",
    sql,
    label,
    prefix = "",
    suffix = "",
    format = "compact",
    decimals = 1,
    size = 36,
    color,
    style,
  } = element.props;
  const queryId = (element.props as { _queryId?: string })._queryId;

  const { rows, columns, loading } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  const rawValue = resolveRawValue(sql, rows, columns, value);

  const fontSizePx = typeof size === "number" && size > 0 ? size : 36;
  const displayValue = formatValue(rawValue, format, decimals);
  // Show the loading placeholder ONLY before any value has resolved. Once the
  // server-resolved rows (or a static `value`) give us a number, render it even
  // while `loading` is still true — a background re-resolve, or an SDK hook that
  // pins `loading` true (e.g. an unresolved `{{ref?p=$param}}` override), must
  // not blank an already-resolved metric back to "…" (the live-board symptom:
  // every tile stuck on "…" despite the SQL resolving server-side). Mirrors the
  // dashboard's "a query state never blanks resolved data" convention.
  const isLoading = !!sql && loading && displayValue === "";

  return (
    <Card className="ofw-card--metric" style={parseStyle(style)}>
      {isLoading ? (
        <SkeletonState variant="metric" />
      ) : (
        <>
          <div
            className="ofw-metric__value"
            style={{ fontSize: `${fontSizePx}px`, color: color || undefined }}
          >
            {prefix}
            {displayValue}
            {suffix}
          </div>
          {label ? <div className="ofw-metric__label">{label}</div> : null}
        </>
      )}
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Metric,
    props: metricProps,
    description: "Dashboard metric card with formatted value.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
