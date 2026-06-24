// Page-level comments overlay (json-ui-comments.md §9): lets a reviewer pin a
// comment to ANY widget node, not just a canvas node. Reads the same page-level
// `__comments` param as the canvas overlay (so the parley/agent loop + URL-sync
// are unchanged) and renders pins in DOCUMENT coordinates, anchored to a node's
// stable `data-ofw-node` path (stamped by render.tsx).
//
// Mounted by main.tsx INSIDE the bridge provider (so `useCanvasComments` →
// `useFusedParam` works) but its visual surface is portaled to <body> for
// clip-free fixed positioning. It owns only `anchorPath` (widget-node) comments;
// canvas-node comments stay with the canvas overlay, and clicks inside a canvas
// surface are ignored here.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import {
  addComment,
  addReply,
  deleteComment,
  editContent,
  isFeedbackWrite,
  reopenComment,
  resolveComment,
  useCanvasComments,
} from "../canvas/canvas-comments";
import type { CanvasComment } from "../canvas/canvas-types";
import {
  CommentThreadPopover,
  PinGlyph,
  cardFlipsAtRightEdge,
  genId,
} from "./comment-thread";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Draft {
  path: string;
  offsetX: number;
  offsetY: number;
  left: number;
  top: number;
}

/** The widget-node element for a stable path, or null if it's gone. */
function nodeEl(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-ofw-node="${path}"]`);
}

/**
 * On-screen box of a node marker. The marker is `display:contents` (no box of
 * its own), so fall back to the union of its children's rects.
 */
function nodeBox(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  let l = Infinity;
  let t = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of Array.from(el.children)) {
    const cr = child.getBoundingClientRect();
    if (cr.width === 0 && cr.height === 0) continue;
    l = Math.min(l, cr.left);
    t = Math.min(t, cr.top);
    right = Math.max(right, cr.right);
    bottom = Math.max(bottom, cr.bottom);
  }
  if (l === Infinity) return null;
  return { left: l, top: t, width: right - l, height: bottom - t };
}

/** Window position of a comment's pin, or null when its node isn't on screen. */
function pinPos(c: CanvasComment): { left: number; top: number } | null {
  if (!c.anchorPath) return null;
  const el = nodeEl(c.anchorPath);
  if (!el) return null;
  const box = nodeBox(el);
  if (!box) return null;
  return {
    left: box.left + Math.min(c.offsetX ?? 0, box.width),
    top: box.top + Math.min(c.offsetY ?? 0, box.height),
  };
}

const TOGGLE_STYLE: CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 2147483000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "1px solid color-mix(in oklab, white 12%, transparent)",
  cursor: "pointer",
  pointerEvents: "auto",
};

function CommentIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function CommentsLayer({
  seed,
  feedbackMode,
  onComment,
  onCommentsChange,
  onRequestCommentMode,
  hideToggle,
}: {
  seed: CanvasComment[] | undefined;
  /** Feedback mode: open comment mode + fire onComment for each new comment
   * (the host buffers them and submits the batch when feedback ends). */
  feedbackMode?: boolean;
  /** New comment: text + which widget it's pinned to (anchorPath here), so the
   * host can tell the agent which widget the feedback targets. */
  onComment?: (c: { text: string; anchorId?: string; anchorPath?: string }) => void;
  /** Called with the FULL comments array on EVERY commit (add/edit/resolve/
   * delete) — distinct from the new-only `onComment`. The host debounces it to
   * persist comments back into the widget config JSON. */
  onCommentsChange?: (comments: CanvasComment[]) => void;
  /** Host-driven comment-mode toggle: when provided, USER gestures that would
   * toggle comment mode (the `C` key, the toggle button, opening a pin) call
   * THIS instead of the local `setCommentMode` — so the app's feedback loop
   * owns the on/off (entering creates the task, leaving sends the batch).
   * `commentMode` itself stays driven by `feedbackMode` via the effect below, so
   * comment mode follows once the host flips feedback. Absent in the standalone
   * MCP bundle (main.tsx), where the local `setCommentMode` behavior is kept. */
  onRequestCommentMode?: (on: boolean) => void;
  /** Hide the floating bottom-right comment toggle button. The app drives
   * comment mode from its header "Feedback mode" button + the `C` key, so the
   * lone dashboard FAB is redundant there. */
  hideToggle?: boolean;
}) {
  const { comments, commit: commitRaw } = useCanvasComments(seed);
  const commit = useCallback(
    (next: Parameters<typeof commitRaw>[0]) => {
      if (feedbackMode && onComment) {
        const prevIds = new Set(comments.map((c) => c.id));
        for (const c of next) {
          if (!prevIds.has(c.id) && c.content?.trim())
            onComment({ text: c.content, anchorId: c.anchorId, anchorPath: c.anchorPath });
        }
      }
      // Start the feedback loop on a feedback WRITE (a new comment, a reopen, or
      // a new reply) — but only when the host drives the loop and it isn't
      // already on. VIEWING a thread (opening a pin) does not commit, so it never
      // reaches here; edit-content / resolve / delete commits are not writes.
      if (onRequestCommentMode && !feedbackMode && isFeedbackWrite(comments, next))
        onRequestCommentMode(true);
      commitRaw(next);
      // Persist the FULL array on every commit — distinct from the new-only
      // `onComment` fan-out above.
      onCommentsChange?.(next);
    },
    [comments, commitRaw, feedbackMode, onComment, onCommentsChange, onRequestCommentMode],
  );
  const [commentMode, setCommentMode] = useState(feedbackMode ?? false);
  // Entering feedback mode opens comments; leaving it closes them.
  useEffect(() => {
    setCommentMode(feedbackMode ?? false);
  }, [feedbackMode]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped on scroll/resize/layout so pins recompute their live positions.
  const [, setTick] = useState(0);
  const retrack = useCallback(() => setTick((n) => n + 1), []);

  // Only this layer's comments (widget-node anchored); canvas owns the rest.
  const pageComments = useMemo(
    () => comments.filter((c) => typeof c.anchorPath === "string"),
    [comments],
  );

  useEffect(() => {
    if (!commentMode) {
      setDraft(null);
      setDraftText("");
    }
  }, [commentMode]);

  // A USER gesture (the `C` key, the toggle button, opening a pin) requesting a
  // comment-mode change. When the host drives the loop (`onRequestCommentMode`
  // provided) we hand it the change INSTEAD of toggling locally — the host flips
  // its feedback loop and `commentMode` follows via the feedbackMode effect
  // above. Standalone (no host) keeps the local toggle. The downstream
  // feedbackMode→setCommentMode sync is NOT routed here (it's not a user
  // gesture), so there is no toggle loop.
  const requestCommentMode = useCallback(
    (on: boolean) => {
      if (onRequestCommentMode) onRequestCommentMode(on);
      else setCommentMode(on);
    },
    [onRequestCommentMode],
  );

  // `C` toggles comment mode, `Esc` exits — ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (e.key === "Escape") requestCommentMode(false);
      else if (
        (e.key === "c" || e.key === "C") &&
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      )
        requestCommentMode(!commentMode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestCommentMode, commentMode]);

  // Re-track pin positions on scroll / resize / any layout change.
  useEffect(() => {
    window.addEventListener("scroll", retrack, true);
    window.addEventListener("resize", retrack);
    const ro = new ResizeObserver(retrack);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", retrack, true);
      window.removeEventListener("resize", retrack);
      ro.disconnect();
    };
  }, [retrack]);

  // Place a comment at a window-space click point: find the widget node under the
  // pointer (skipping our own overlay; a canvas-surface node belongs to the
  // canvas overlay, so bail). Reads `clientX/clientY` off a NATIVE MouseEvent so
  // it can run from a capture-phase document listener (no covering div) — that
  // keeps wheel/two-finger-scroll passing straight through to the page while a
  // click still places a comment. Returns true when it consumed the click (so the
  // caller can stop it from activating the widget underneath).
  const placeCommentAt = useCallback((clientX: number, clientY: number): boolean => {
    const els = document.elementsFromPoint(clientX, clientY);
    let target: HTMLElement | null = null;
    for (const el of els) {
      if (el.closest(".ofw-comments-layer")) continue;
      const node = el.closest<HTMLElement>("[data-ofw-node]");
      if (!node) continue;
      if (node.closest(".react-flow") || node.closest(".canvas-surface"))
        return false;
      target = node;
      break;
    }
    if (!target) return false;
    const path = target.getAttribute("data-ofw-node");
    if (!path) return false;
    const box = nodeBox(target);
    if (!box) return false;
    setOpenId(null);
    setDraft({
      path,
      offsetX: clientX - box.left,
      offsetY: clientY - box.top,
      left: clientX,
      top: clientY,
    });
    setDraftText("");
    return true;
  }, []);

  // Comment placement without a blocking overlay: while comment mode is on,
  // intercept clicks at the CAPTURE phase on the document. A capturing listener
  // sees the click before the widget under the pointer, so we can place a
  // comment and `stopPropagation`/`preventDefault` to keep the widget from
  // activating — WITHOUT touching wheel/scroll/keyboard, so two-finger scroll
  // passes straight through to the page (the old `pointer-events:auto` cover
  // div ate it). A click inside our own overlay (pins, draft, popover) is left
  // alone so those controls keep working. A `crosshair` body cursor signals the
  // mode.
  useEffect(() => {
    if (!commentMode) return;
    const onDocClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest(".ofw-comments-layer")) return; // our own controls
      if (placeCommentAt(e.clientX, e.clientY)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener("click", onDocClick, true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.body.style.cursor = prevCursor;
    };
  }, [commentMode, placeCommentAt]);

  const submitDraft = useCallback(() => {
    if (!draft) return;
    const text = draftText.trim();
    if (text === "") {
      setDraft(null);
      return;
    }
    commit(
      addComment(comments, {
        id: genId("cmt"),
        content: text,
        author: "human",
        status: "open",
        replies: [],
        createdAt: Date.now(),
        anchorPath: draft.path,
        offsetX: draft.offsetX,
        offsetY: draft.offsetY,
      }),
    );
    setDraft(null);
    setDraftText("");
  }, [draft, draftText, comments, commit]);

  const openComment = useMemo(
    () => pageComments.find((c) => c.id === openId) ?? null,
    [pageComments, openId],
  );
  const openPin = openComment ? pinPos(openComment) : null;

  return createPortal(
    <div
      className="ofw-comments-layer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147482000,
        pointerEvents: "none",
      }}
    >
      {/* No click-capture div: comment placement runs through a capture-phase
          document click listener (see the effect above), so wheel/two-finger
          scroll passes straight through to the page while a click still places a
          comment. A canvas-node click is bailed in placeCommentAt so the canvas
          keeps it. */}

      {/* Pins. */}
      {pageComments.map((c) => {
        const pos = pinPos(c);
        if (!pos) return null; // node off-screen / gone → not rendered (still in __comments)
        const resolved = c.status === "resolved";
        return (
          <button
            key={c.id}
            type="button"
            className={`canvas-comment-pin${resolved ? " is-resolved" : ""}${
              c.id === openId ? " is-open" : ""
            }`}
            title={c.content}
            aria-label={`${resolved ? "Resolved" : "Open"} comment: ${
              c.content
            }`}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 2,
              pointerEvents: "auto",
            }}
            onClick={(e) => {
              e.stopPropagation();
              setDraft(null);
              // Clicking a pin only toggles its thread popover — VIEWING a
              // comment must NOT start the feedback loop. The loop starts on a
              // feedback WRITE (new comment / reopen / reply), handled in `commit`.
              setOpenId((prev) => (prev === c.id ? null : c.id));
            }}
          >
            <PinGlyph resolved={resolved} replies={c.replies?.length ?? 0} />
          </button>
        );
      })}

      {/* Inline draft input at the click point — flips left near the right edge. */}
      {draft ? (
        <div
          className={`canvas-comment-draft glass${
            cardFlipsAtRightEdge(draft.left, window.innerWidth)
              ? " is-flipped"
              : ""
          }`}
          style={{
            position: "fixed",
            left: draft.left,
            top: draft.top,
            zIndex: 3,
            pointerEvents: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            autoFocus
            className="canvas-comment-input"
            placeholder="Add a comment…"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
              } else if (e.key === "Enter" && !e.shiftKey) {
                // Enter submits the comment; Shift+Enter inserts a newline.
                e.preventDefault();
                submitDraft();
              }
            }}
            rows={2}
          />
          <div className="canvas-comment-draft-actions">
            <button
              type="button"
              className="canvas-comment-btn-ghost"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="canvas-comment-btn-primary"
              onClick={submitDraft}
              disabled={draftText.trim() === ""}
            >
              Comment
            </button>
          </div>
        </div>
      ) : null}

      {/* Thread popover — tracks its pin on scroll. */}
      {openComment && openPin ? (
        <CommentThreadPopover
          comment={openComment}
          pin={openPin}
          onClose={() => setOpenId(null)}
          onReply={(text) => {
            const now = Date.now();
            commit(
              addReply(
                comments,
                openComment.id,
                {
                  id: genId("reply"),
                  content: text,
                  author: "human",
                  createdAt: now,
                },
                now,
              ),
            );
          }}
          onEdit={(text) =>
            commit(editContent(comments, openComment.id, text, Date.now()))
          }
          onResolve={() =>
            commit(
              resolveComment(comments, openComment.id, "human", Date.now()),
            )
          }
          onReopen={() =>
            commit(reopenComment(comments, openComment.id, Date.now()))
          }
          onDelete={() => {
            commit(deleteComment(comments, openComment.id));
            setOpenId(null);
          }}
        />
      ) : null}

      {/* Comment-mode toggle (this layer has no canvas controls cluster).
          Hidden when the host drives the mode (`hideToggle`) — e.g. the app,
          where the header "Feedback mode" button + the `C` key cover it. */}
      {hideToggle ? null : (
        <button
          type="button"
          className="glass canvas-control-btn"
          onClick={() => requestCommentMode(!commentMode)}
          title={commentMode ? "Exit comment mode (Esc)" : "Comment (C)"}
          aria-label={commentMode ? "Exit comment mode" : "Add a comment"}
          aria-pressed={commentMode}
          style={{
            ...TOGGLE_STYLE,
            color: commentMode
              ? "var(--canvas-accent, #4aa3ff)"
              : "var(--ofw-text-dim, #93a0b2)",
          }}
        >
          <CommentIcon />
        </button>
      )}
    </div>,
    document.body,
  );
}
