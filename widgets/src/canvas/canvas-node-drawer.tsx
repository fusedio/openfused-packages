/**
 * Node peek-drawer: a right-side panel that peeks ONE node's artifact read-only,
 * without leaving the canvas (config `nodePeek`). Sibling to
 * `canvas-fullscreen-overlay.tsx`, but a slide-in side drawer rather than a
 * full-viewport modal — the canvas stays live and interactive on the left, and
 * the drawer re-targets as the user clicks node to node.
 *
 * Chrome only: the body content is supplied by the caller (the renderer passes
 * either the host's `renderNodePeek(node)` output or a default `RenderNode` of
 * the node's own widget). Rendered via createPortal to document.body so it
 * escapes the ReactFlow transform and the node card's `overflow-hidden`.
 *
 * NO backdrop dim: there is no full-viewport scrim, so clicks on the canvas pass
 * straight through (it stays interactive). Close with `✕`, Esc, or by clicking a
 * different node (re-targets). `⤢` runs the caller's expand action.
 */
import React from "react";
import { createPortal } from "react-dom";

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

function ExpandIcon({ size = 15 }: { size?: number }) {
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
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

export interface CanvasNodeDrawerProps {
  title: string;
  onClose: () => void;
  /** `⤢` handler. When omitted the expand button is not shown. */
  onExpand?: () => void;
  children: React.ReactNode;
}

export function CanvasNodeDrawer({
  title,
  onClose,
  onExpand,
  children,
}: CanvasNodeDrawerProps) {
  // Slide in on mount (transform 100% → 0). Reduced motion → no transition.
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc closes (capture + stop so it doesn't also bubble to a parent overlay).
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

  return createPortal(
    <aside
      className="ofw-node-drawer"
      data-enter={entered ? "true" : undefined}
      role="dialog"
      aria-modal="false"
      aria-label={title || "Node"}
    >
      <div className="ofw-node-drawer__header">
        <div className="ofw-node-drawer__title" title={title}>
          {title || "Node"}
        </div>
        {onExpand ? (
          <button
            type="button"
            className="ofw-node-drawer__btn"
            onClick={onExpand}
            aria-label="Open full page"
            title="Open full page"
          >
            <ExpandIcon size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="ofw-node-drawer__btn"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="ofw-node-drawer__body">{children}</div>
    </aside>,
    document.body,
  );
}

CanvasNodeDrawer.displayName = "CanvasNodeDrawer";
