// Per-widget-type sizing for canvas nodes: estimates (used to seed the layout
// before content is measured) + min/max clamps. Container-filling widgets
// (charts/maps/iframe) have no intrinsic content size and are never measured.
// See docs/specs/json-ui-canvas/features/canvas-layout-polish.md §3.

import type { CanvasNode, JsonUiNode } from "./canvas-types";

export interface Size {
  width: number;
  height: number;
}

export interface SizeProfile {
  min: Size;
  max: Size;
  estimate: Size;
}

export const GLOBAL_MIN: Size = { width: 160, height: 80 };

// Height grows to fit content (a node with text + a dropdown + one or more
// charts needs ~460–760px); width stays bounded per type so columns read well.
// This ceiling only guards pathological content, not normal dashboards.
const GLOBAL_MAX_HEIGHT = 880;

const DEFAULT_PROFILE: SizeProfile = {
  min: GLOBAL_MIN,
  max: { width: 520, height: 480 },
  estimate: { width: 300, height: 180 },
};

/** Widget types whose rendered content has no intrinsic size (they fill their box). */
const FILL_TYPES = new Set<string>([
  "bar-chart",
  "line-chart",
  "scatter-chart",
  "donut-chart",
  "heatmap-chart",
  "stacked-area-chart",
  "stacked-bar-chart",
  "fused-map",
  "map-h3",
  "map-bounds",
  "udf-map",
  "iframe",
  "image",
  "html",
  "sql-table",
]);

const PROFILES: Record<string, SizeProfile> = {
  metric: {
    min: GLOBAL_MIN,
    max: { width: 320, height: 200 },
    estimate: { width: 220, height: 120 },
  },
  text: {
    min: GLOBAL_MIN,
    max: { width: 520, height: 600 },
    estimate: { width: 320, height: 160 },
  },
  slider: {
    min: GLOBAL_MIN,
    max: { width: 360, height: 200 },
    estimate: { width: 300, height: 110 },
  },
  dropdown: {
    min: GLOBAL_MIN,
    max: { width: 360, height: 200 },
    estimate: { width: 300, height: 110 },
  },
  "text-input": {
    min: GLOBAL_MIN,
    max: { width: 360, height: 200 },
    estimate: { width: 300, height: 110 },
  },
  "number-input": {
    min: GLOBAL_MIN,
    max: { width: 360, height: 200 },
    estimate: { width: 300, height: 110 },
  },
  "text-area": {
    min: GLOBAL_MIN,
    max: { width: 420, height: 320 },
    estimate: { width: 320, height: 160 },
  },
  form: {
    min: GLOBAL_MIN,
    max: { width: 420, height: 520 },
    estimate: { width: 320, height: 260 },
  },
  "bar-chart": {
    min: GLOBAL_MIN,
    max: { width: 640, height: 520 },
    estimate: { width: 360, height: 260 },
  },
  "line-chart": {
    min: GLOBAL_MIN,
    max: { width: 640, height: 520 },
    estimate: { width: 360, height: 260 },
  },
  "fused-map": {
    min: GLOBAL_MIN,
    max: { width: 720, height: 640 },
    estimate: { width: 440, height: 320 },
  },
  "sql-table": {
    min: GLOBAL_MIN,
    max: { width: 720, height: 520 },
    estimate: { width: 420, height: 260 },
  },
};

/** The top-level widget type of a node. */
export function primaryKind(node: CanvasNode): string {
  return node.widget.type;
}

/** Every widget type present in a node's subtree (walks children). */
export function collectWidgetTypes(widget: JsonUiNode): Set<string> {
  const out = new Set<string>();
  const visit = (w: JsonUiNode | undefined): void => {
    if (!w || typeof w.type !== "string") return;
    out.add(w.type);
    for (const c of w.children ?? []) visit(c);
  };
  visit(widget);
  return out;
}

/** True if the node's subtree contains a container-filling widget (chart/map/iframe/…). */
export function isFill(node: CanvasNode): boolean {
  for (const t of collectWidgetTypes(node.widget)) {
    if (FILL_TYPES.has(t)) return true;
  }
  return false;
}

function profileFor(node: CanvasNode): SizeProfile {
  // A subtree containing a fill widget but whose top type lacks a profile uses a chart-ish box.
  const direct = PROFILES[primaryKind(node)];
  if (direct) return direct;
  if (isFill(node)) return PROFILES["bar-chart"];
  return DEFAULT_PROFILE;
}

export function clampSize(size: Size, node: CanvasNode): Size {
  const p = profileFor(node);
  return {
    width: Math.min(p.max.width, Math.max(p.min.width, Math.round(size.width))),
    // Width is bounded per type; height is free to fit content (charts want
    // ~300px each) up to a generous global ceiling.
    height: Math.min(
      GLOBAL_MAX_HEIGHT,
      Math.max(p.min.height, Math.round(size.height)),
    ),
  };
}

// --- Deterministic content-height estimation -------------------------------
// Charts render asynchronously (recharts ResponsiveContainer), so measuring a
// node's height at mount races the chart and yields a too-short value → the
// layout under-spaces and tall chart nodes overlap. Instead we estimate height
// deterministically from the widget subtree, biased slightly HIGH (a little
// extra gap is harmless; overlap is not). These match observed render heights
// within ~40px for the relay2 dashboard.

const CHART_TYPES = new Set<string>([
  "bar-chart",
  "line-chart",
  "scatter-chart",
  "donut-chart",
  "heatmap-chart",
  "stacked-area-chart",
  "stacked-bar-chart",
]);
const MAP_TYPES = new Set<string>([
  "fused-map",
  "map-h3",
  "map-bounds",
  "udf-map",
]);
const CONTROL_TYPES = new Set<string>([
  "slider",
  "dropdown",
  "text-input",
  "number-input",
  "text-area",
  "datetime-input",
  "color-input",
  "camera-input",
  "gallery-input",
]);

const NODE_HEADER_H = 38; // node title bar
const DIV_PAD_V = 28; // a flex container's vertical padding
const CHILD_GAP = 8; // gap between stacked children

// Estimate a text widget's height from its content: count newline-separated
// segments, each wrapping at ~CHARS_PER_LINE, times a per-variant line height.
// Biased slightly high — a long markdown block (the overview node) is many
// lines and must not be under-counted (that caused stacked nodes to overlap).
function textHeight(props: Record<string, unknown> | undefined): number {
  const variant = props?.variant;
  const value =
    typeof props?.value === "string"
      ? props.value
      : typeof props?.text === "string"
        ? props.text
        : "";
  const lineH =
    variant === "h1"
      ? 40
      : variant === "h2"
        ? 34
        : variant === "h3" || variant === "h4"
          ? 28
          : variant === "small"
            ? 18
            : 22;
  const CHARS_PER_LINE = 50;
  let lines = 0;
  for (const seg of (value || " ").split("\n")) {
    lines += Math.max(1, Math.ceil(seg.length / CHARS_PER_LINE));
  }
  return Math.round(Math.max(1, lines) * lineH + 14);
}

/** Estimated rendered height of a widget subtree (px), biased slightly high. */
function widgetHeight(w: JsonUiNode): number {
  const t = w.type;
  if (t === "text") return textHeight(w.props);
  if (t === "metric") return 96;
  if (t === "button") return 44;
  if (CONTROL_TYPES.has(t)) return 76; // label + control
  if (CHART_TYPES.has(t)) return 340; // ~300 plot (flex-basis) + title
  if (MAP_TYPES.has(t)) return 360;
  if (t === "iframe" || t === "image" || t === "html") return 240;
  if (t === "sql-table") return 340;
  if (t === "div" || t === "form") {
    const kids = w.children ?? [];
    const childHs = kids.map(widgetHeight);
    const style = typeof w.props?.style === "string" ? w.props.style : "";
    const isRow = /flex-direction:\s*row/.test(style);
    if (isRow) return Math.max(0, ...childHs) + DIV_PAD_V; // row: tallest child
    const sum =
      childHs.reduce((a, b) => a + b, 0) +
      Math.max(0, kids.length - 1) * CHILD_GAP;
    return sum + DIV_PAD_V; // column: stacked
  }
  return 180; // unknown widget — a safe-ish default box
}

/** Deterministic node height (header + content), clamped to [min, ceiling]. */
export function estimateContentHeight(node: CanvasNode): number {
  const h = (node.title ? NODE_HEADER_H : 0) + widgetHeight(node.widget) + 8;
  return Math.min(
    GLOBAL_MAX_HEIGHT,
    Math.max(GLOBAL_MIN.height, Math.round(h)),
  );
}

/** Per-type width (bounded) + deterministic content height. */
export function estimateSize(node: CanvasNode): Size {
  return {
    width: clampSize(profileFor(node).estimate, node).width,
    height: estimateContentHeight(node),
  };
}
