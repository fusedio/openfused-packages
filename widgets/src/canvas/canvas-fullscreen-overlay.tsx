/**
 * Node fullscreen overlay: expands one node's widget to fill the viewport.
 *
 * Ported from the app's mcp-host `canvas/canvas-fullscreen-overlay.tsx`. KEY
 * RESHAPING: renders `node.widget` through openfused's `RenderNode` (from
 * `../render`) instead of `compileConfig`/`<Renderer>`, under the SAME per-node
 * bridge as the inline node so params still flow while fullscreen. Tokens
 * re-expressed in `--ofw-*`; the X icon is inlined (no lucide-react dep).
 *
 * Rendered via createPortal to document.body so it escapes the ReactFlow
 * transform and the node card's `overflow-hidden`. Sits at z-index 40 — above
 * the canvas but BELOW any body-portaled menu layer — so a widget's dropdown
 * opened in fullscreen renders on top of the backdrop, not behind it.
 */
import React from "react";
import { createPortal } from "react-dom";

import {
  FusedWidgetBridgeContext,
  type FusedWidgetBridge,
} from "@fusedio/widget-sdk";

import { RenderNode, type UINode } from "../render";
import type { CanvasNode as CanvasNodeModel } from "./canvas-types";

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
  background: "var(--ofw-bg, #070a0f)",
  display: "flex",
  flexDirection: "column",
};

const TOP_BAR_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  gap: 12,
  padding: "10px 16px",
  borderBottom: "1px solid var(--ofw-line, rgba(130,160,200,0.11))",
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ofw-text, #e7ecf3)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const CLOSE_BUTTON_STYLE: React.CSSProperties = {
  display: "flex",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: "var(--ofw-radius-sm, 7px)",
  border: "none",
  background: "transparent",
  color: "var(--ofw-text, #e7ecf3)",
  cursor: "pointer",
};

const BODY_STYLE: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "auto",
  padding: 20,
};

function CloseIcon({ size = 16 }: { size?: number }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

class OverlayErrorBoundary extends React.Component<
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 12,
          }}
        >
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

export interface CanvasFullscreenOverlayProps {
  node: CanvasNodeModel;
  bridge: FusedWidgetBridge;
  onClose: () => void;
}

export function CanvasFullscreenOverlay({
  node,
  bridge,
  onClose,
}: CanvasFullscreenOverlayProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const topBarRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  // Esc closes; backdrop click (outside the content) closes.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onBackdropMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Treat a click as backdrop-dismiss only when it lands on the overlay's own
      // empty area: DOM-inside this overlay (rootRef) but outside the widget
      // content and the top bar. The `rootRef.contains` guard keeps a click on a
      // body-portaled menu option from dismissing fullscreen.
      const target = e.target as Node;
      if (
        rootRef.current?.contains(target) &&
        !contentRef.current?.contains(target) &&
        !topBarRef.current?.contains(target)
      ) {
        onClose();
      }
    },
    [onClose],
  );

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={node.title || "Node"}
      style={OVERLAY_STYLE}
      onMouseDown={onBackdropMouseDown}
    >
      <div ref={topBarRef} style={TOP_BAR_STYLE}>
        <div style={TITLE_STYLE}>{node.title || "Node"}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit fullscreen"
          title="Exit fullscreen"
          style={CLOSE_BUTTON_STYLE}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div style={BODY_STYLE}>
        <FusedWidgetBridgeContext.Provider value={bridge}>
          <div
            ref={contentRef}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              width: "100%",
            }}
          >
            <OverlayErrorBoundary>
              <RenderNode node={node.widget as UINode} />
            </OverlayErrorBoundary>
          </div>
        </FusedWidgetBridgeContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

CanvasFullscreenOverlay.displayName = "CanvasFullscreenOverlay";
