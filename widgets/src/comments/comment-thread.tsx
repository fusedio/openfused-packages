// Shared comment UI + helpers used by BOTH the canvas overlay (flow-coord pins)
// and the page-level CommentsLayer (document-coord pins). The thread popover,
// pin glyph, relative-time formatter, and id generator are anchor-agnostic — only
// where a pin is positioned differs between the two overlays, so that stays in
// each overlay; everything visual + the close/track behaviour lives here.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { CanvasComment } from "../canvas/canvas-types";

/** Movement (px) past which a pointer-down is a drag/pan, not a click. */
export const DRAG_THRESHOLD_PX = 4;

let idCounter = 0;
/** Stable-enough unique id for a comment / reply created in this session. */
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** Human-readable relative time — matches the Workbench comment UI. */
export function timeAgo(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min. ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr. ago`;
  return `${Math.floor(diff / 86400)} d. ago`;
}

export function PinGlyph({
  resolved,
  replies,
}: {
  resolved: boolean;
  replies: number;
}) {
  return (
    <span className="canvas-comment-pin-glyph" aria-hidden>
      {resolved ? "✓" : replies > 0 ? String(replies) : ""}
    </span>
  );
}

interface PopoverProps {
  comment: CanvasComment;
  /** Live window position of the pin the popover anchors to. */
  pin: { left: number; top: number };
  onClose: () => void;
  onReply: (text: string) => void;
  onEdit: (text: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

const POPOVER_WIDTH = 300;
const POPOVER_MAX_HEIGHT = 460;
const PIN_GAP = 14;

/** Floating comment-card width (canvas.css) + its pin gap + viewport margin —
 * shared by the overlays' draft/hovercard right-edge flip logic. */
export const CARD_WIDTH_PX = 240;
export const CARD_GAP_PX = 14;
export const EDGE_MARGIN_PX = 8;

/** True when a 240px card anchored at window-x `left` would overflow the right edge. */
export function cardFlipsAtRightEdge(left: number, paneWidth: number): boolean {
  return left + CARD_GAP_PX + CARD_WIDTH_PX > paneWidth - EDGE_MARGIN_PX;
}

export function CommentThreadPopover({
  comment,
  pin,
  onClose,
  onReply,
  onEdit,
  onResolve,
  onReopen,
  onDelete,
}: PopoverProps) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const ref = useRef<HTMLDivElement | null>(null);

  // ACTUAL rendered height (re-measured every render — replies/edit mode change
  // it). The bottom clamp must use this, NOT the max height: clamping by
  // POPOVER_MAX_HEIGHT yanked short threads ~460px above any pin in the lower
  // half of the window ("popover not where the pin is").
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight;
    if (typeof h === "number" && h > 0) {
      setMeasuredH((prev) => (prev === h ? prev : h));
    }
  });

  // Position relative to the pin, recomputed every render → tracks pan/zoom and
  // page scroll. Flip left when it would overflow the right edge; clamp top by
  // the measured height so the popover hugs its pin.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const flipLeft = pin.left + PIN_GAP + POPOVER_WIDTH > vw - 8;
  const left = flipLeft
    ? Math.max(8, pin.left - PIN_GAP - POPOVER_WIDTH)
    : pin.left + PIN_GAP;
  const clampH = Math.min(measuredH ?? POPOVER_MAX_HEIGHT, POPOVER_MAX_HEIGHT);
  const top = Math.max(8, Math.min(pin.top - 8, vh - clampH - 8));

  // A *click* outside closes; a *drag* outside (panning / selecting) does NOT —
  // the popover stays open and tracks its pin. Click vs drag = pointer movement
  // between down and up. Pointer events (capture) match how React Flow drives the
  // pane; a click on another pin is left to that pin's own onClick.
  useEffect(() => {
    let tracking = false;
    let moved = false;
    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (ref.current && t && ref.current.contains(t)) return; // inside popover
      if (t instanceof Element && t.closest(".canvas-comment-pin")) return; // a pin
      tracking = true;
      moved = false;
      downX = e.clientX;
      downY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (
        tracking &&
        Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_THRESHOLD_PX
      ) {
        moved = true;
      }
    };
    const onUp = () => {
      if (tracking && !moved) onClose(); // a click, not a drag
      tracking = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const resolved = comment.status === "resolved";
  const style: CSSProperties = {
    position: "fixed",
    left,
    top,
    width: POPOVER_WIDTH,
  };

  return createPortal(
    <div
      ref={ref}
      className="canvas-comment-popover glass"
      role="dialog"
      aria-label="Comment thread"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="canvas-comment-thread">
        <Message
          author={comment.author}
          content={comment.content}
          createdAt={comment.createdAt}
          editing={editing}
          editText={editText}
          setEditText={setEditText}
          onSubmitEdit={() => {
            const t = editText.trim();
            if (t !== "") onEdit(t);
            setEditing(false);
          }}
          onStartEdit={() => {
            setEditText(comment.content);
            setEditing(true);
          }}
        />
        {(comment.replies ?? []).map((r) => (
          <Message
            key={r.id}
            author={r.author}
            content={r.content}
            createdAt={r.createdAt}
          />
        ))}
      </div>

      {!resolved ? (
        <div className="canvas-comment-reply-row">
          <input
            className="canvas-comment-input canvas-comment-reply-input"
            placeholder="Reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const t = reply.trim();
                if (t !== "") {
                  onReply(t);
                  setReply("");
                }
              }
            }}
          />
        </div>
      ) : null}

      <div className="canvas-comment-actions">
        {resolved ? (
          <button
            type="button"
            className="canvas-comment-btn-ghost"
            onClick={onReopen}
          >
            Reopen
          </button>
        ) : (
          <button
            type="button"
            className="canvas-comment-btn-primary"
            onClick={onResolve}
          >
            Resolve
          </button>
        )}
        <button
          type="button"
          className="canvas-comment-btn-ghost"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface MessageProps {
  author: string;
  content: string;
  createdAt: number;
  editing?: boolean;
  editText?: string;
  setEditText?: (v: string) => void;
  onSubmitEdit?: () => void;
  onStartEdit?: () => void;
}

function Message({
  author,
  content,
  createdAt,
  editing,
  editText,
  setEditText,
  onSubmitEdit,
  onStartEdit,
}: MessageProps) {
  return (
    <div className="canvas-comment-msg">
      <div className="canvas-comment-msg-head">
        <span
          className={`canvas-comment-author canvas-comment-author--${author}`}
        >
          {author === "agent" ? "Agent" : "You"}
        </span>
        <span className="canvas-comment-time">{timeAgo(createdAt)}</span>
        {onStartEdit && !editing ? (
          <button
            type="button"
            className="canvas-comment-edit-link"
            onClick={onStartEdit}
            aria-label="Edit comment"
          >
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="canvas-comment-input"
          value={editText}
          rows={2}
          onChange={(e) => setEditText?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              // Enter saves the edit; Shift+Enter inserts a newline.
              e.preventDefault();
              onSubmitEdit?.();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onSubmitEdit?.();
            }
          }}
          onBlur={onSubmitEdit}
        />
      ) : (
        <div className="canvas-comment-msg-body">{content}</div>
      )}
    </div>
  );
}
