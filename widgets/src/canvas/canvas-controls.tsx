// Floating canvas chrome: a glass zoom/fit control cluster anchored bottom-right.
// Ported from the app's mcp-host `canvas/canvas-controls.tsx`; re-expressed in
// openfused's tokens, with lucide icons inlined as SVGs (no lucide-react dep).
// No minimap, no whole-canvas fullscreen (only per-node fullscreen).
//
// The `.glass` utility is defined in canvas.css.

import { memo, useCallback, type CSSProperties } from "react";

import { Panel, useReactFlow } from "@xyflow/react";

const ICON_SIZE = 16;

// Panel ships a default opaque background/border/shadow; clear it so the glass
// children own the surface.
const CLEAR_PANEL_STYLE: CSSProperties = {
  background: "transparent",
  border: "none",
  boxShadow: "none",
};

const BUTTON_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: "var(--ofw-radius-sm, 7px)",
  border: "none",
  background: "transparent",
  color: "var(--ofw-text-dim, #93a0b2)",
  cursor: "pointer",
  transition: "color 120ms ease, background 120ms ease",
};

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ZoomInIcon() {
  return (
    <svg {...svgProps(ICON_SIZE)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg {...svgProps(ICON_SIZE)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg {...svgProps(ICON_SIZE)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg {...svgProps(ICON_SIZE)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * Bottom-right floating canvas chrome: a glass cluster of zoom-in / zoom-out /
 * fit-view buttons wired to `useReactFlow()`.
 */
export const CanvasControls = memo(function CanvasControls({
  fitViewPadding,
  showComments = false,
  commentMode = false,
  onToggleComments,
}: {
  fitViewPadding: number;
  /** Show the comment-mode toggle (canvas `enableComments`). */
  showComments?: boolean;
  /** Whether comment mode is currently active. */
  commentMode?: boolean;
  /** Toggle comment mode on/off. */
  onToggleComments?: () => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomIn = useCallback(() => {
    void zoomIn();
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    void zoomOut();
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    // Programmatic re-frame uses the "slow" easing; instant under reduced motion
    // (a CSS @media query can't gate fitView's rAF tween).
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    void fitView({ padding: fitViewPadding, duration: reduce ? 0 : 600 });
  }, [fitView, fitViewPadding]);

  return (
    <Panel
      position="bottom-right"
      className="canvas-controls-panel"
      style={CLEAR_PANEL_STYLE}
    >
      <div
        className="glass canvas-controls-cluster"
        role="group"
        aria-label="Canvas zoom controls"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          padding: 4,
        }}
      >
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
          className="canvas-control-btn"
          style={BUTTON_STYLE}
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
          className="canvas-control-btn"
          style={BUTTON_STYLE}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          onClick={handleFitView}
          title="Zoom to fit"
          aria-label="Zoom to fit"
          className="canvas-control-btn"
          style={BUTTON_STYLE}
        >
          <MaximizeIcon />
        </button>
        {showComments ? (
          <button
            type="button"
            onClick={onToggleComments}
            title={commentMode ? "Exit comment mode (Esc)" : "Comment (C)"}
            aria-label={commentMode ? "Exit comment mode" : "Add a comment"}
            aria-pressed={commentMode}
            className={`canvas-control-btn${commentMode ? " is-active" : ""}`}
            style={
              commentMode
                ? { ...BUTTON_STYLE, color: "var(--canvas-accent, #4aa3ff)" }
                : BUTTON_STYLE
            }
          >
            <CommentIcon />
          </button>
        ) : null}
      </div>
    </Panel>
  );
});
