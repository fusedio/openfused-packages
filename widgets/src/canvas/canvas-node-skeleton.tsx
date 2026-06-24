/**
 * canvas-node-skeleton.tsx — a SHAPE-MATCHED loading skeleton for one canvas
 * node, shown while the canvas's first data resolve is in flight
 * (CanvasHostValue.dataLoading; see canvas-renderer.tsx). It replaces the old
 * spinner: instead of a generic spinner, it walks the node's OWN widget subtree
 * (the same `UINode` the node renders once data lands) and reproduces its shape
 * — real static text/labels/titles paint immediately, and shimmer placeholder
 * blocks stand in only where data-bound content (a non-empty `props.sql`) will
 * appear — so when the rows arrive the layout barely moves.
 *
 * Self-contained in the ui/canvas package by design:
 *   - It does NOT import the app's `WidgetSkeleton` (that one lives on a
 *     different surface — the app's WidgetDetailView — and is built on
 *     Tailwind/shadcn `@kit` primitives, which this `--ofw-*`-token,
 *     inline-style package cannot use). The small config walk and the
 *     "data slot = non-empty props.sql" heuristic are reimplemented here.
 *   - The shimmer animation + reduced-motion fallback live in canvas.css
 *     (`.canvas-skel*`), reusing the existing `--ofw-*` palette.
 *
 * The walk mirrors the renderer's own structure (render.tsx) and the per-type
 * chrome of the real widgets (metric/text/chart/sql-table/Card), so the static
 * scaffold reads as the same component, just unfilled.
 */
import React from "react";

import type { JsonUiNode } from "./canvas-types";

// Chart-family types render as a filled plot area (no intrinsic rows). Mirrors
// canvas-node-size.ts CHART_TYPES.
const CHART_TYPES = new Set<string>([
  "bar-chart",
  "line-chart",
  "scatter-chart",
  "heatmap-chart",
  "stacked-area-chart",
  "stacked-bar-chart",
]);
// Box-filling, non-chart visual types (map/iframe/image/html) → one big block.
const BLOCK_TYPES = new Set<string>([
  "fused-map",
  "map-h3",
  "map-bounds",
  "udf-map",
  "iframe",
  "image",
  "html",
  "video",
  "video-review",
]);

/** A node is data-bound when its props carry a non-empty `props.sql` string. */
function isDataSlot(props: Record<string, unknown> | undefined): boolean {
  return (
    !!props && typeof props.sql === "string" && props.sql.trim() !== ""
  );
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse a `props.style` CSS string into a React style object so a `div`'s
 * authored layout (flex direction, gap, grid, padding) is reproduced in the
 * skeleton. Split on ";", then each declaration on the FIRST ":" only (values
 * like `repeat(4, 1fr)` keep their colons); kebab property names → camelCase.
 * Mirrors the app WidgetSkeleton's `parseStyle` (and the SDK `parseStyle`),
 * reimplemented locally to keep the package self-contained.
 */
function parseStyleString(styleStr: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of styleStr.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    const camel = prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out as React.CSSProperties;
}

// --------------------------------------------------------------- shimmer block
/**
 * One shimmer placeholder block standing in for a data value/row/plot. `flex`
 * lets a block grow to fill the remaining space (used for chart/table/map
 * bodies); otherwise it sizes to width/height.
 */
function Shimmer({
  width,
  height,
  radius,
  flex,
  circle,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  flex?: boolean;
  circle?: boolean;
}) {
  const style: React.CSSProperties = {
    width: circle ? height : (width ?? "100%"),
    height: height ?? 12,
    borderRadius: circle ? "50%" : (radius ?? 6),
  };
  if (flex) {
    style.flex = "1 1 auto";
    style.minHeight = 0;
  }
  return <div className="canvas-skel-shimmer" style={style} aria-hidden="true" />;
}

// A static (real) text line — paints immediately, no shimmer.
const STATIC_TEXT_BASE: React.CSSProperties = {
  margin: 0,
  color: "var(--ofw-text, #e7ecf3)",
  lineHeight: 1.4,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function staticTextStyle(variant: string): React.CSSProperties {
  switch (variant) {
    case "h1":
      return { ...STATIC_TEXT_BASE, fontSize: 30, fontWeight: 700 };
    case "h2":
      return { ...STATIC_TEXT_BASE, fontSize: 24, fontWeight: 600 };
    case "h3":
      return { ...STATIC_TEXT_BASE, fontSize: 20, fontWeight: 600 };
    case "h4":
      return { ...STATIC_TEXT_BASE, fontSize: 16, fontWeight: 600 };
    case "large":
      return { ...STATIC_TEXT_BASE, fontSize: 16 };
    case "small":
      return {
        ...STATIC_TEXT_BASE,
        fontSize: 12,
        color: "var(--ofw-text-dim, #93a0b2)",
      };
    case "muted":
      return {
        ...STATIC_TEXT_BASE,
        fontSize: 14,
        color: "var(--ofw-text-dim, #93a0b2)",
      };
    default:
      return { ...STATIC_TEXT_BASE, fontSize: 14 };
  }
}

// Card chrome matching components/card.tsx (.ofw-card): flex column, gap 12,
// padding 16/18/18; the title is a small uppercase dim label.
const SKEL_CARD_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "16px 18px 18px",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};
const SKEL_CARD_TITLE_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.11em",
  textTransform: "uppercase",
  color: "var(--ofw-text-dim, #93a0b2)",
};

// A real (static) widget title paints immediately; a data-bound title shimmers.
function CardTitle({ title }: { title: string }) {
  return <div style={SKEL_CARD_TITLE_STYLE}>{title}</div>;
}

// --------------------------------------------------------------- node walk
/**
 * Render the skeleton for one widget node. Returns the shape-matched scaffold:
 * static chrome painted for real, shimmer blocks only at data slots.
 */
function SkeletonNode({
  node,
}: {
  node: JsonUiNode | undefined;
}): React.ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return null;
  }
  const type = node.type;
  const props = (node.props ?? {}) as Record<string, unknown>;
  const dataSlot = isDataSlot(props);

  // --- div / form: a layout container → reproduce its authored style + recurse.
  if (type === "div" || type === "form") {
    const authored = parseStyleString(asString(props.style));
    const style: React.CSSProperties = {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minWidth: 0,
      ...authored,
    };
    const children = Array.isArray(node.children) ? node.children : [];
    return (
      <div style={style}>
        {children.map((child, i) => (
          <SkeletonNode key={i} node={child} />
        ))}
      </div>
    );
  }

  // --- text: static text paints for real; a SQL-bound text shimmers a line.
  if (type === "text") {
    const variant = asString(props.variant) || "default";
    if (dataSlot) {
      const h =
        variant === "h1"
          ? 28
          : variant === "h2"
            ? 22
            : variant === "h3"
              ? 18
              : 14;
      return <Shimmer height={h} width="60%" />;
    }
    const value = asString(props.value);
    if (!value) return null;
    return <div style={staticTextStyle(variant)}>{value}</div>;
  }

  // --- metric: real label, shimmer the big value (always SQL-bound in practice).
  if (type === "metric") {
    const label = asString(props.label);
    const sizeRaw = props.size;
    const fontSize = typeof sizeRaw === "number" && sizeRaw > 0 ? sizeRaw : 36;
    const valueH = Math.round(fontSize * 0.78);
    return (
      <div style={SKEL_CARD_STYLE}>
        <Shimmer height={valueH} width="55%" radius={8} />
        {label ? (
          <div
            style={{ fontSize: 13, color: "var(--ofw-text-dim, #93a0b2)" }}
          >
            {label}
          </div>
        ) : null}
      </div>
    );
  }

  // --- charts: real title, shimmer the plot. Donut → centered circle.
  if (type === "donut-chart") {
    const title = asString(props.title);
    return (
      <div style={SKEL_CARD_STYLE}>
        {title ? <CardTitle title={title} /> : null}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Shimmer height={132} circle />
        </div>
      </div>
    );
  }
  if (CHART_TYPES.has(type)) {
    const title = asString(props.title);
    return (
      <div style={SKEL_CARD_STYLE}>
        {title ? <CardTitle title={title} /> : null}
        <Shimmer flex height={undefined} radius={8} />
      </div>
    );
  }

  // --- sql-table: real title, a stack of shimmer rows (a header + body rows).
  if (type === "sql-table") {
    const title = asString(props.title);
    return (
      <div style={SKEL_CARD_STYLE}>
        {title ? <CardTitle title={title} /> : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          <Shimmer height={16} width="40%" radius={4} />
          <Shimmer height={14} />
          <Shimmer height={14} />
          <Shimmer height={14} />
          <Shimmer height={14} width="80%" />
        </div>
      </div>
    );
  }

  // --- box-filling visual types (map / iframe / image / html / video).
  if (BLOCK_TYPES.has(type)) {
    return <Shimmer flex radius={8} />;
  }

  // --- input controls (slider/dropdown/inputs/button): rarely data-bound, but
  // if data-bound show a control-shaped placeholder so the slot is honored.
  if (dataSlot) {
    return <Shimmer height={36} radius={8} />;
  }

  // --- static unknown leaf: nothing to show; recurse any children defensively.
  if (Array.isArray(node.children) && node.children.length > 0) {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
      >
        {node.children.map((child, i) => (
          <SkeletonNode key={i} node={child} />
        ))}
      </div>
    );
  }
  return null;
}

/**
 * The node-body skeleton: the shape-matched scaffold for `widget`, plus a small,
 * unobtrusive elapsed-seconds timer pinned bottom-right (a slow UDF visibly
 * shows how long it has been resolving). `role="status"` + `aria-busy` announce
 * the loading state to assistive tech.
 */
export function CanvasNodeSkeleton({
  widget,
}: {
  widget: JsonUiNode;
}): React.ReactElement {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="canvas-skel"
      role="status"
      aria-busy="true"
      aria-label="Loading data"
    >
      <div className="canvas-skel__body">
        <SkeletonNode node={widget} />
      </div>
      <div className="canvas-skel__time" aria-hidden="true">
        {seconds}s
      </div>
    </div>
  );
}
