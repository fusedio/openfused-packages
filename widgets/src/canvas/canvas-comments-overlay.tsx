// The canvas comments overlay (json-ui-comments.md §3): pins rendered in flow
// coordinates (they pan/zoom with the canvas), comment-mode click-to-place with
// an inline draft input, drag-to-reanchor, a hover preview, and a screen-space
// thread popover that TRACKS its pin as you pan/zoom. All mutations go through
// the pure ops in canvas-comments.ts and `commit`, which writes the __comments
// param — fanning out to the parley (-> agent) and URL-sync (-> human).
//
// Rendered as a child of <ReactFlow> (like CanvasControls): it reads the live
// viewport transform via `useStore` (so every pin + the open popover reposition
// on pan/zoom) and converts pointer -> flow coords via `useReactFlow`.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useReactFlow, useStore } from "@xyflow/react";

import {
  CommentThreadPopover,
  DRAG_THRESHOLD_PX,
  PinGlyph,
  cardFlipsAtRightEdge,
  genId,
  timeAgo,
} from "../comments/comment-thread";
import {
  addComment,
  addReply,
  deleteComment,
  editContent,
  reopenComment,
  resolveComment,
} from "./canvas-comments";
import type { CanvasComment } from "./canvas-types";

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Draft {
  flowX: number;
  flowY: number;
  anchorId?: string;
  offsetX?: number;
  offsetY?: number;
}

interface CanvasCommentsOverlayProps {
  comments: CanvasComment[];
  commit: (next: CanvasComment[]) => void;
  commentMode: boolean;
  nodeBoxes: Map<string, NodeBox>;
  /** Members of collapsed folders: their anchored pins are hidden (the comment
   * stays in __comments; it returns when the folder expands). Without this the
   * pin falls back to its free x/y and floats over the collapsed bar. */
  hiddenNodeIds: ReadonlySet<string>;
}

/** Imperative handle: the renderer routes a ReactFlow pane/node CLICK (not a
 * drag — so pan/zoom/scroll stay native) here to open a comment draft at the
 * click point. The placement logic (screen→flow → hit-test → anchor) lives
 * here; the caller gates on commentMode. */
export interface CanvasCommentsHandle {
  placeAt: (clientX: number, clientY: number) => void;
}

const HOVER_DELAY_MS = 220;

/** Flow-coordinate position of a comment's pin (node-anchored or free). */
function pinFlowPos(
  c: CanvasComment,
  nodeBoxes: Map<string, NodeBox>,
): { x: number; y: number } {
  if (c.anchorId) {
    const box = nodeBoxes.get(c.anchorId);
    if (box) {
      return {
        x: box.x + Math.min(c.offsetX ?? 0, box.width),
        y: box.y + Math.min(c.offsetY ?? 0, box.height),
      };
    }
  }
  return { x: c.x ?? 0, y: c.y ?? 0 };
}

function hitTest(
  flow: { x: number; y: number },
  nodeBoxes: Map<string, NodeBox>,
): { id: string; box: NodeBox } | null {
  for (const [id, box] of nodeBoxes) {
    if (
      flow.x >= box.x &&
      flow.x <= box.x + box.width &&
      flow.y >= box.y &&
      flow.y <= box.y + box.height
    ) {
      return { id, box };
    }
  }
  return null;
}

const LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "visible",
  zIndex: 6,
};

export const CanvasCommentsOverlay = forwardRef<
  CanvasCommentsHandle,
  CanvasCommentsOverlayProps
>(function CanvasCommentsOverlay(
  { comments, commit, commentMode, nodeBoxes, hiddenNodeIds },
  ref,
) {
  const { screenToFlowPosition } = useReactFlow();
  const transform = useStore((s) => s.transform); // [x, y, zoom] — re-renders on pan/zoom
  const [tx, ty, zoom] = transform;

  const layerRef = useRef<HTMLDivElement | null>(null);
  const [layerRect, setLayerRect] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragScreen, setDragScreen] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggedRef = useRef(false); // suppress the click that follows a drag

  // Keep the layer's window rect current (pins/popover use it for screen coords).
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const update = () => setLayerRect(el.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);

  // Leaving comment mode clears any in-flight draft.
  useEffect(() => {
    if (!commentMode) {
      setDraft(null);
      setDraftText("");
    }
  }, [commentMode]);

  /** Pane-relative screen position of a flow point. */
  const toScreen = useCallback(
    (flow: { x: number; y: number }) => ({
      left: flow.x * zoom + tx,
      top: flow.y * zoom + ty,
    }),
    [tx, ty, zoom],
  );

  // Open a comment draft at a window-space click point: screen→flow, hit-test
  // to anchor onto a node when the point lands inside one, else a free pin.
  // Called by the renderer from ReactFlow's onPaneClick/onNodeClick (which fire
  // only on a click, not a drag), so pan/zoom/scroll stay native. The caller
  // gates on commentMode.
  const placeAt = useCallback(
    (clientX: number, clientY: number) => {
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      const hit = hitTest(flow, nodeBoxes);
      setOpenId(null);
      setDraft(
        hit
          ? {
              flowX: flow.x,
              flowY: flow.y,
              anchorId: hit.id,
              offsetX: flow.x - hit.box.x,
              offsetY: flow.y - hit.box.y,
            }
          : { flowX: flow.x, flowY: flow.y },
      );
      setDraftText("");
    },
    [screenToFlowPosition, nodeBoxes],
  );

  useImperativeHandle(ref, () => ({ placeAt }), [placeAt]);

  const submitDraft = useCallback(() => {
    if (!draft) return;
    const text = draftText.trim();
    if (text === "") {
      setDraft(null);
      return;
    }
    const now = Date.now();
    const c: CanvasComment = {
      id: genId("cmt"),
      content: text,
      author: "human",
      status: "open",
      replies: [],
      createdAt: now,
      x: draft.flowX,
      y: draft.flowY,
    };
    if (draft.anchorId) {
      c.anchorId = draft.anchorId;
      c.offsetX = draft.offsetX;
      c.offsetY = draft.offsetY;
    }
    commit(addComment(comments, c));
    setDraft(null);
    setDraftText("");
  }, [draft, draftText, comments, commit]);

  // ---- Drag a pin to reposition / re-anchor (commit once on release) --------
  const startDrag = useCallback(
    (e: React.PointerEvent, comment: CanvasComment) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      draggedRef.current = false;
      const startX = e.clientX;
      const startY = e.clientY;
      const base = toScreen(pinFlowPos(comment, nodeBoxes));

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX)
          return;
        draggedRef.current = true;
        setDragId(comment.id);
        setDragScreen({ left: base.left + dx, top: base.top + dy });
      };
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDragId(null);
        setDragScreen(null);
        if (!draggedRef.current) return; // a click, not a drag
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const hit = hitTest(flow, nodeBoxes);
        const next = comments.map((c) => {
          if (c.id !== comment.id) return c;
          const updated: CanvasComment = {
            ...c,
            x: flow.x,
            y: flow.y,
            updatedAt: Date.now(),
          };
          if (hit) {
            updated.anchorId = hit.id;
            updated.offsetX = flow.x - hit.box.x;
            updated.offsetY = flow.y - hit.box.y;
          } else {
            delete updated.anchorId;
            delete updated.offsetX;
            delete updated.offsetY;
          }
          return updated;
        });
        commit(next);
        // Defer clearing so the click handler that fires after pointerup is suppressed.
        requestAnimationFrame(() => {
          draggedRef.current = false;
        });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [toScreen, nodeBoxes, screenToFlowPosition, comments, commit],
  );

  const onPinEnter = useCallback((id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverId(id), HOVER_DELAY_MS);
  }, []);
  const onPinLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverId(null);
  }, []);

  const closePopover = useCallback(() => setOpenId(null), []);

  // If the open/hovered comment's anchor just hid (folder collapsed), let go.
  useEffect(() => {
    const anchorHidden = (id: string | null) => {
      if (!id) return false;
      const c = comments.find((x) => x.id === id);
      return !!c?.anchorId && hiddenNodeIds.has(c.anchorId);
    };
    if (anchorHidden(openId)) setOpenId(null);
    if (anchorHidden(hoverId)) setHoverId(null);
  }, [openId, hoverId, comments, hiddenNodeIds]);

  /** Card anchored at pane-relative `left` would overflow the pane's right edge. */
  const flipsAtRightEdge = useCallback(
    (left: number) =>
      layerRect != null && cardFlipsAtRightEdge(left, layerRect.width),
    [layerRect],
  );

  const openComment = useMemo(
    () => comments.find((c) => c.id === openId) ?? null,
    [comments, openId],
  );
  const hoverComment = useMemo(
    () =>
      hoverId && hoverId !== openId
        ? comments.find((c) => c.id === hoverId) ?? null
        : null,
    [comments, hoverId, openId],
  );

  // Window position of a comment's pin (layer offset + pane-relative screen pos).
  const pinWindowPos = useCallback(
    (c: CanvasComment) => {
      const s = toScreen(pinFlowPos(c, nodeBoxes));
      const ox = layerRect?.left ?? 0;
      const oy = layerRect?.top ?? 0;
      return { left: ox + s.left, top: oy + s.top };
    },
    [toScreen, nodeBoxes, layerRect],
  );

  return (
    <div ref={layerRef} className="canvas-comments-layer" style={LAYER_STYLE}>
      {/* No click-capture layer: comment placement is routed through ReactFlow's
          onPaneClick/onNodeClick (renderer → placeAt), so pan/zoom/scroll stay
          native. This layer only hosts pins, hovercards, the draft, and the
          thread popover (each with explicit pointer targets). */}

      {/* Pins — flow-positioned, constant screen size, draggable. */}
      {comments.map((c) => {
        if (c.anchorId && hiddenNodeIds.has(c.anchorId)) return null;
        const pos =
          dragId === c.id && dragScreen
            ? dragScreen
            : toScreen(pinFlowPos(c, nodeBoxes));
        const resolved = c.status === "resolved";
        return (
          <button
            key={c.id}
            type="button"
            className={`canvas-comment-pin${resolved ? " is-resolved" : ""}${
              c.id === openId ? " is-open" : ""
            }${dragId === c.id ? " is-dragging" : ""}`}
            aria-label={`${resolved ? "Resolved" : "Open"} comment: ${
              c.content
            }`}
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              zIndex: 2,
            }}
            onPointerDown={(e) => startDrag(e, c)}
            onMouseEnter={() => onPinEnter(c.id)}
            onMouseLeave={onPinLeave}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedRef.current) return; // ignore the click synthesized after a drag
              setDraft(null);
              setHoverId(null);
              // Clicking a pin only toggles its thread popover — VIEWING a
              // comment must NOT start the feedback loop. The loop starts on a
              // feedback WRITE (new comment / reopen / reply), handled by the
              // renderer's `commit` wrapper.
              setOpenId((prev) => (prev === c.id ? null : c.id));
            }}
          >
            <PinGlyph resolved={resolved} replies={c.replies?.length ?? 0} />
          </button>
        );
      })}

      {/* Hover preview card — flips left of the pin near the right edge. */}
      {hoverComment ? (
        <div
          className={`canvas-comment-hovercard glass${
            flipsAtRightEdge(toScreen(pinFlowPos(hoverComment, nodeBoxes)).left)
              ? " is-flipped"
              : ""
          }`}
          style={{
            position: "absolute",
            ...toScreen(pinFlowPos(hoverComment, nodeBoxes)),
            zIndex: 4,
          }}
        >
          <div className="canvas-comment-hovercard-author">
            {hoverComment.author === "agent" ? "Agent" : "You"}
            <span className="canvas-comment-time">
              {timeAgo(hoverComment.createdAt)}
            </span>
          </div>
          <div className="canvas-comment-hovercard-body">
            {hoverComment.content}
          </div>
          {(hoverComment.replies?.length ?? 0) > 0 ? (
            <div className="canvas-comment-hovercard-more">
              {hoverComment.replies!.length} repl
              {hoverComment.replies!.length === 1 ? "y" : "ies"}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Inline draft input at the click point — flips left near the right edge. */}
      {draft ? (
        <div
          className={`canvas-comment-draft glass${
            flipsAtRightEdge(toScreen({ x: draft.flowX, y: draft.flowY }).left)
              ? " is-flipped"
              : ""
          }`}
          style={{
            position: "absolute",
            ...toScreen({ x: draft.flowX, y: draft.flowY }),
            zIndex: 3,
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

      {/* Thread popover — screen space, portaled to body, TRACKS the pin. */}
      {openComment ? (
        <CommentThreadPopover
          comment={openComment}
          pin={pinWindowPos(openComment)}
          onClose={closePopover}
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
    </div>
  );
});
