// _sparkline.tsx — a pure, presentational sparkline (NO SDK, no data binding).
//
// A tiny axis/grid/tooltip-less trend for a numeric series. Reused by the
// `sparkline` widget (SQL-driven) and inline by the `kpi` tile, so the trend
// look is single-sourced. Pure props-in / SVG-out (recharts), like the dumb
// ui-kit primitives — the data-binding wrapper lives in the widget files.

import React from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line } from "recharts";

export function Sparkline({
  data,
  color = "var(--ofw-accent)",
  area = true,
  strokeWidth = 2,
  height = 40,
}: {
  /** The numeric series, oldest → newest. */
  data: number[];
  /** Stroke (and fill-gradient base) color. Defaults to the lime accent. */
  color?: string;
  /** Fill the area under the line. */
  area?: boolean;
  strokeWidth?: number;
  /** Pixel height of the spark. */
  height?: number;
}) {
  // Unique gradient id per instance so multiple sparklines on one page don't
  // share (and clobber) a single `<defs>` gradient.
  const gid = React.useId().replace(/:/g, "");
  const rows = (data ?? []).filter((n) => typeof n === "number" && !Number.isNaN(n)).map((v, i) => ({ i, v }));
  if (rows.length < 2) return null;

  return (
    <div className="ofw-sparkline" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {area ? (
          <AreaChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.34} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              dataKey="v"
              type="monotone"
              stroke={color}
              strokeWidth={strokeWidth}
              fill={`url(#${gid})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <Line
              dataKey="v"
              type="monotone"
              stroke={color}
              strokeWidth={strokeWidth}
              isAnimationActive={false}
              dot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
