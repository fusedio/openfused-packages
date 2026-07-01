/**
 * The custom ReactFlow node: a solid card (header + body) whose body renders the
 * node's widget subtree through openfused's recursive renderer, wrapped in the
 * node's edge-gated bridge. A render failure is caught by a node-scoped error
 * boundary and never throws past the node boundary (canvas-view.md
 * B-CANVAS-VIEW-09).
 *
 * KEY RESHAPING vs. the app's mcp-host canvas-node:
 *   - The app compiled `node.widget` with `compileConfig` and rendered
 *     `<Renderer tree registry>` from `@json-render/react`. openfused has
 *     neither. Instead we render `node.widget` via openfused's own renderer
 *     export `RenderNode` (from `../render`) — the same recursive walk every
 *     top-level widget goes through. `RenderNode` reads the registry internally
 *     and, for any data-bound child, wraps it in `JsonUiBindingContext` itself
 *     (it stamps `_queryId` from props), so no registry/binding threading is
 *     needed here.
 *   - The whole subtree is wrapped in this node's
 *     `<FusedWidgetBridgeContext.Provider value={bridge}>` (the per-node
 *     edge-gated bridge), so its widgets read params filtered to the node's
 *     allowed sources and its SQL re-resolves through the node's own data store.
 *   - Chrome is re-expressed in openfused's `--ofw-*` tokens + inline styles (no
 *     Tailwind/shadcn). The maximize icon is an inline SVG (no lucide-react dep).
 */
import React from "react";
import { createPortal } from "react-dom";

import {
  FusedWidgetBridgeContext,
  type FusedWidgetBridge,
} from "@fusedio/widget-sdk";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { RenderNode, type UINode } from "../render";
import { CanvasNodeSkeleton } from "./canvas-node-skeleton";
import type { CanvasNode as CanvasNodeModel } from "./canvas-types";

// Edges need handles to attach to, but in view mode the handles are not
// interactive — keep them invisible and out of the layout.
const HIDDEN_HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  border: "none",
  minWidth: 0,
  minHeight: 0,
};

/**
 * Widget types that capture pointer/click and therefore need `nodrag` + real
 * pointer events to work inside a node. Everything else is display-only and
 * stays fully pannable/zoomable "through" — you can drag the canvas over a
 * text / metric / chart node without getting stuck on it. Keep this set TIGHT:
 * only add a type when it genuinely needs to own the gesture.
 */
const INTERACTIVE_TYPES = new Set<string>([
  "slider",
  "dropdown",
  "text-input",
  "number-input",
  "text-area",
  "datetime-input",
  "color-input",
  "button",
  "form",
]);

/**
 * Controls a node-peek click must NOT hijack: clicking a button/input/etc. inside
 * a node should drive that control, not open the peek-drawer. A plain element (or
 * the compact name-link `<a>`, which we DO want to intercept) is not exempt.
 */
const PEEK_EXEMPT_SELECTOR =
  'button, input, select, textarea, label, [role="button"], [contenteditable=""], [contenteditable="true"]';

/** True if the click landed on (or inside) an interactive control — used to let
 * that control's own handler run instead of opening the node peek-drawer. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(PEEK_EXEMPT_SELECTOR) != null;
}

/** True if the widget subtree contains any interactive control (walks children). */
function hasInteractiveControl(widget: CanvasNodeModel["widget"]): boolean {
  let found = false;
  const visit = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    const rec = n as { type?: unknown; children?: unknown };
    if (typeof rec.type === "string" && INTERACTIVE_TYPES.has(rec.type)) {
      found = true;
      return;
    }
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
  };
  visit(widget);
  return found;
}

export interface CanvasNodeData {
  node: CanvasNodeModel;
  bridge: FusedWidgetBridge;
  running?: boolean;
  /** The canvas's first data resolve is still in flight and this node is
   * data-bound → render a shape-matched skeleton of the node's OWN widget
   * (static text/labels paint immediately, shimmer blocks stand in for the
   * data) instead of the not-yet-bindable widget, so there's minimal jolt when
   * data lands (pipeline overview; see CanvasHostValue.dataLoading). */
  loading?: boolean;
  /** Expand this node's widget to fill the viewport (set by CanvasInner). */
  onFullscreen?: (nodeId: string) => void;
  /** Open the node peek-drawer for this node (set by CanvasInner when the canvas
   * config has `nodePeek`). A node click opens the drawer instead of following
   * the node's default link navigation; clicks on interactive controls are
   * exempt (see `isInteractiveTarget`). */
  onPeek?: (nodeId: string) => void;
  [key: string]: unknown;
}

// The maximize / fullscreen icon (inlined — no lucide-react dependency).
function MaximizeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

// The hover-revealed maximize button (top-right). Must work on DISPLAY nodes
// too — those keep `pointer-events:none` on the card so drags pan the canvas —
// so the button re-enables pointer events and is `nodrag nopan` so clicking it
// neither drags the node nor pans the canvas.
const MAXIMIZE_BUTTON_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  zIndex: 5,
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: "var(--ofw-radius-sm, 7px)",
  border: "1px solid var(--ofw-line-2, rgba(130,160,200,0.20))",
  background: "color-mix(in oklab, var(--ofw-card, #0d1219) 75%, transparent)",
  color: "var(--ofw-text, #e7ecf3)",
  cursor: "pointer",
  backdropFilter: "blur(6px)",
};

// Floating hover tooltip (title + description). Rendered via portal to body so
// it escapes the card's `overflow-hidden` and the ReactFlow transform.
const TOOLTIP_STYLE: React.CSSProperties = {
  position: "fixed",
  zIndex: 2147483000,
  maxWidth: 280,
  padding: "6px 8px",
  background: "var(--ofw-panel, #0e131c)",
  border: "1px solid var(--ofw-line-2, rgba(130,160,200,0.20))",
  borderRadius: "var(--ofw-radius-sm, 7px)",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
  fontSize: 12,
  pointerEvents: "none",
};
const TOOLTIP_TITLE_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ofw-text, #e7ecf3)",
};
const TOOLTIP_DESC_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: "var(--ofw-text-dim, #93a0b2)",
};

const NODE_HEADER_STYLE: React.CSSProperties = {
  flexShrink: 0,
  borderBottom: "1px solid var(--ofw-line, rgba(130,160,200,0.11))",
  background: "var(--ofw-panel-2, #11171f)",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ofw-text-dim, #93a0b2)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const ERROR_CARD_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 12,
  height: "100%",
  width: "100%",
};

/**
 * Node-scoped error boundary: a thrown render error inside the widget subtree
 * paints an in-card error rather than crashing the whole canvas
 * (B-CANVAS-VIEW-09). openfused's `RenderNode` itself never throws for unknown
 * types (it renders a placeholder), but a widget that throws at runtime is
 * caught here.
 */
class NodeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={ERROR_CARD_STYLE}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            Could not render widget
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 12,
              color: "var(--ofw-danger, #ff6470)",
            }}
          >
            {this.state.error.message || "Invalid widget config."}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export const CanvasNode = React.memo(function CanvasNode({ data }: NodeProps) {
  const { node, bridge, running, loading, onFullscreen, onPeek } =
    data as unknown as CanvasNodeData;

  // Only nodes with an interactive control capture the pointer / opt out of
  // dragging; display nodes stay "transparent" to canvas pan/zoom (below).
  const interactive = React.useMemo(
    () => hasInteractiveControl(node.widget),
    [node.widget],
  );

  const cardRef = React.useRef<HTMLDivElement | null>(null);
  // The body wrapper, measured for overflow (below). Content resolves async —
  // tables/charts fill in later — so a ResizeObserver re-checks on every resize.
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // True only when the body's content actually exceeds its box. When set we let
  // the body scroll (overflow:auto + `nowheel`/`nopan` + pointer-events) so the
  // wheel scrolls the node instead of zooming the canvas; when false we leave the
  // node untouched (display nodes stay pan/zoom-transparent — wheel zooms canvas).
  const [scrollable, setScrollable] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  // Recompute on each hover-enter (no live scroll/pan tracking; hidden on leave).
  const [tooltipPos, setTooltipPos] = React.useState<{
    left: number;
    top: number;
  } | null>(null);

  const hasMeta = !!(node.title || node.description);

  const handleMouseEnter = React.useCallback(() => {
    setHovered(true);
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      // Just above the card's top-left, escaping its overflow-hidden.
      setTooltipPos({ left: r.left, top: Math.max(r.top - 8, 0) });
    }
  }, []);

  const handleMouseLeave = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (
        e.relatedTarget instanceof Node &&
        cardRef.current?.contains(e.relatedTarget)
      ) {
        return;
      }
      setHovered(false);
    },
    [],
  );

  const handleFullscreen = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onFullscreen?.(node.id);
    },
    [onFullscreen, node.id],
  );

  // Node peek (config `nodePeek`): a click anywhere on the card — except on an
  // interactive control — opens the peek-drawer and cancels the node's default
  // link navigation. Capture phase so it pre-empts the compact name-link `<a>`'s
  // own navigation even though the card itself may be pointer-events:none.
  const handlePeekClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      onPeek?.(node.id);
    },
    [onPeek, node.id],
  );

  // Measure whether the body content overflows its box and toggle `scrollable`.
  // The body's children resolve async (a data table / chart fills in after the
  // SQL resolves), so a ResizeObserver re-checks on every size change of the body
  // and its content wrapper rather than measuring once on mount.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const overflows =
        el.scrollHeight > el.clientHeight + 1 ||
        el.scrollWidth > el.clientWidth + 1;
      setScrollable((prev) => (prev === overflows ? prev : overflows));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Also observe the content wrapper: when overflow turns the body scrollable
    // its own clientHeight shrinks (scrollbar), but the content size is what
    // actually grows as data fills in.
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      // Capture phase: pre-empt the compact name-link `<a>`'s navigation so a node
      // click opens the peek-drawer instead. Only wired when the host enabled peek.
      onClickCapture={onPeek ? handlePeekClick : undefined}
      className="canvas-node"
      data-running={running ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        borderRadius: "var(--ofw-radius, 10px)",
        border: "1px solid var(--ofw-line, rgba(130,160,200,0.11))",
        background: "var(--ofw-card, #0d1219)",
        color: "var(--ofw-text, #e7ecf3)",
        // RF sets `.react-flow__node { pointer-events: none }` for
        // non-selectable nodes. Re-enable it ONLY for interactive nodes (so
        // their controls work and the canvas doesn't pan out from under them).
        // Display nodes keep pointer-events:none on purpose, so a drag/wheel
        // over them pans/zooms the CANVAS — the user is never stuck on a node.
        // When peek is on, the WHOLE card is a click target (cursor:pointer) so
        // any node opens the drawer, not just its inner link.
        ...(onPeek
          ? { pointerEvents: "auto" as const, cursor: "pointer" as const }
          : interactive
            ? { pointerEvents: "auto" as const }
            : null),
      }}
    >
      {/* Hidden handles so edges can attach; not interactive in view mode. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={HIDDEN_HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={HIDDEN_HANDLE_STYLE}
      />
      {/* Maximize button: top-right, revealed on hover (always focusable for
          a11y). `nodrag nopan` + pointer-events:auto so it works on display
          nodes too without panning the canvas. Suppressed when the host omits
          `onFullscreen` (the Overview canvas — a name-only node has nothing to
          maximize). */}
      {onFullscreen && (
        <button
          type="button"
          onClick={handleFullscreen}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          title="Fullscreen"
          aria-label="Fullscreen"
          className="nodrag nopan"
          style={{ ...MAXIMIZE_BUTTON_STYLE, opacity: hovered ? 1 : 0.55 }}
        >
          <MaximizeIcon size={14} />
        </button>
      )}
      {node.title ? (
        <div
          title={node.title}
          className="canvas-node__header"
          style={NODE_HEADER_STYLE}
        >
          {node.title}
        </div>
      ) : null}
      {/* `nodrag` is added ONLY to interactive nodes so dragging a control
          doesn't drag the node. Display nodes get NO interaction class, so a
          drag/wheel over them pans/zooms the canvas.

          When the content OVERFLOWS the box (`scrollable`), the body becomes a
          scroll container: `overflow:auto` to scroll, `nowheel` so the wheel
          scrolls the node instead of zooming the canvas (ReactFlow honors it),
          `nopan` so dragging the scrollbar/content doesn't pan, and
          pointer-events:auto so scrolling works even on a display node (whose
          card keeps pointer-events:none). When it does NOT overflow we add none
          of these — behavior is identical to today (display nodes stay
          pan/zoom-transparent; the user can wheel-zoom the canvas over them). */}
      <div
        ref={bodyRef}
        className={`canvas-node__body${interactive ? " nodrag" : ""}${
          scrollable ? " nowheel nopan" : ""
        }`}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          ...(scrollable
            ? { overflow: "auto", pointerEvents: "auto" }
            : null),
        }}
      >
        {loading ? (
          <CanvasNodeSkeleton widget={node.widget} />
        ) : (
          <FusedWidgetBridgeContext.Provider value={bridge}>
            <div
              className={interactive ? "nodrag" : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                width: "100%",
              }}
            >
              <NodeErrorBoundary>
                <RenderNode node={node.widget as UINode} />
              </NodeErrorBoundary>
            </div>
          </FusedWidgetBridgeContext.Provider>
        )}
      </div>
      {hovered && hasMeta && tooltipPos
        ? createPortal(
            <div
              role="tooltip"
              style={{
                ...TOOLTIP_STYLE,
                left: tooltipPos.left,
                top: tooltipPos.top,
                transform: "translateY(-100%)",
              }}
            >
              {node.title ? (
                <div style={TOOLTIP_TITLE_STYLE}>{node.title}</div>
              ) : null}
              {node.description ? (
                <div style={TOOLTIP_DESC_STYLE}>{node.description}</div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

CanvasNode.displayName = "CanvasNode";
