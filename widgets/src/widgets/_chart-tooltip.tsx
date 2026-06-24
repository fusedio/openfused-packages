// _chart-tooltip.tsx — the ONE shared chart tooltip (interaction-audit §3.1).
//
// Every recharts chart (bar/line/scatter/donut/stacked-bar/stacked-area) renders
// THIS as its `<Tooltip content={...}>` so the tooltip looks identical everywhere
// — one default style (the `.ofw-chart-tooltip` panel in widget.css), no per-chart
// divergence. (The heatmap is custom divs, not recharts, but reuses the same
// `.ofw-chart-tooltip` classes.) Authors override appearance via the panel CSS, not
// per-widget.
//
// Robust to the ComposedChart case (line+area) where recharts hands each series
// twice: rows are deduped by name. The swatch color falls back to the slice fill
// (`payload.fill`) so donut/pie slices show their color.

export interface ChartTooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  payload?: { fill?: string; percent?: number };
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const seen = new Set<string>();
  const items = payload.filter((e) => {
    const k = String(e.name ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!items.length) return null;

  const colorOf = (e: ChartTooltipEntry) => e.color ?? e.payload?.fill;
  // A single-series cartesian point (one row, name matches the axis label) reads
  // cleaner as just the value; donut/multi-series show labelled, swatched rows.
  const single = items.length === 1 && (items[0].name == null || items[0].name === label);

  return (
    <div className="ofw-chart-tooltip">
      {label != null && label !== "" ? (
        <div className="ofw-chart-tooltip__label">{label}</div>
      ) : null}
      {single ? (
        <div className="ofw-chart-tooltip__value">
          {Number(items[0].value).toLocaleString()}
        </div>
      ) : (
        items.map((entry, i) => (
          <div className="ofw-chart-tooltip__row" key={i}>
            <span className="ofw-chart-tooltip__swatch" style={{ backgroundColor: colorOf(entry) }} />
            <span className="ofw-chart-tooltip__name">{entry.name}</span>
            <span className="ofw-chart-tooltip__value">{Number(entry.value).toLocaleString()}</span>
          </div>
        ))
      )}
    </div>
  );
}
