/**
 * Node peek-drawer: a right-side panel that peeks ONE node's artifact read-only,
 * without leaving the canvas (config `nodePeek`). Sibling to
 * `canvas-fullscreen-overlay.tsx`, but a slide-in side drawer rather than a
 * full-viewport modal — the canvas stays live and interactive on the left, and
 * the drawer re-targets as the user clicks node to node.
 *
 * Chrome only: the body content is supplied by the caller (`renderBody(node)` —
 * the host's `renderNodePeek` output, or a default `RenderNode` of the node's own
 * widget). Rendered via createPortal to document.body so it escapes the ReactFlow
 * transform and the node card's `overflow-hidden`.
 *
 * Lifecycle (owned here so the panel animates BOTH ways):
 *   - `node` non-null → mount + slide IN (ease-out).
 *   - `node` switches to another node → panel stays put, the body CROSS-FADES
 *     (keyed on node id); the slide is not replayed.
 *   - `node` → null → slide OUT (ease-in), then unmount. Under prefers-reduced-
 *     motion (the global `* { transition:none }` rule) no transition fires, so a
 *     timer drives the unmount.
 * Focus: non-modal (`aria-modal="false"` — the canvas stays usable), but focus
 * still ENTERS the panel on open and is RESTORED to the prior element on close.
 *
 * NO backdrop dim: there is no full-viewport scrim, so clicks on the canvas pass
 * straight through. Close with `✕`, Esc, or by clicking a different node.
 */
import React from "react";
import { createPortal } from "react-dom";

import type { CanvasNode as CanvasNodeModel } from "./canvas-types";

// Slightly longer than the 200ms slide so the unmount lands after it visually
// completes; also the reduced-motion fallback (no transitionend there).
const EXIT_MS = 240;

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
  /** The node to peek, or null to close (slide out + unmount). */
  node: CanvasNodeModel | null;
  /** Drawer title for the given node (called with the retained node during exit). */
  title: (node: CanvasNodeModel) => string;
  /** The read-only body for the given node. */
  renderBody: (node: CanvasNodeModel) => React.ReactNode;
  /** Request close (the parent sets `node` to null). */
  onClose: () => void;
  /** `⤢` handler. When omitted the expand button is not shown. */
  onExpand?: (node: CanvasNodeModel) => void;
}

export function CanvasNodeDrawer({
  node,
  title,
  renderBody,
  onClose,
  onExpand,
}: CanvasNodeDrawerProps) {
  // `shown` is the node currently rendered — RETAINED through the exit animation
  // after `node` goes null. `entered` drives the slide transform.
  const [shown, setShown] = React.useState<CanvasNodeModel | null>(node);
  const [entered, setEntered] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (node) {
      // Open or re-target. Save focus only on a FRESH open (no node shown yet).
      setShown((prev) => {
        if (!prev)
          restoreFocusRef.current =
            (document.activeElement as HTMLElement | null) ?? null;
        return node;
      });
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    // Close: slide out, then unmount + restore focus.
    setEntered(false);
    const t = window.setTimeout(() => {
      setShown(null);
      const el = restoreFocusRef.current;
      restoreFocusRef.current = null;
      el?.focus?.();
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [node]);

  // Focus the panel once it is open (non-modal: enter focus, no trap).
  React.useEffect(() => {
    if (entered) panelRef.current?.focus();
  }, [entered]);

  // Esc closes (capture + stop so it doesn't also bubble to a parent overlay).
  React.useEffect(() => {
    if (!shown) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, onClose]);

  return createPortal(
    shown ? (
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="ofw-node-drawer"
        data-enter={entered ? "true" : undefined}
        role="dialog"
        aria-modal="false"
        aria-label={title(shown) || "Node"}
      >
        <div className="ofw-node-drawer__header">
          <div className="ofw-node-drawer__title" title={title(shown)}>
            {title(shown) || "Node"}
          </div>
          <div className="ofw-node-drawer__actions">
            {onExpand ? (
              <button
                type="button"
                className="ofw-node-drawer__btn"
                onClick={() => onExpand(shown)}
                aria-label="Open full page"
                title="Open full page"
              >
                <ExpandIcon size={15} />
              </button>
            ) : null}
            <button
              type="button"
              className="ofw-node-drawer__btn ofw-node-drawer__btn--close"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div className="ofw-node-drawer__body">
          {/* Keyed on node id so a re-target REMOUNTS → replays the content
              cross-fade (the panel itself stays put — no slide replay). */}
          <div key={shown.id} className="ofw-node-drawer__content">
            {renderBody(shown)}
          </div>
        </div>
      </aside>
    ) : null,
    document.body,
  );
}

CanvasNodeDrawer.displayName = "CanvasNodeDrawer";
