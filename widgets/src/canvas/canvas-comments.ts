// Canvas comments — pure data layer + the param hook (json-ui-comments.md).
//
// A comment thread is canvas-level data carried on the reserved `__comments`
// param. This module is the single source of truth for the comment array's
// shape discipline (normalize / sort / drop-blank) and the immutable mutators
// the overlay calls. Everything here is host-agnostic and deterministic — ids
// and timestamps are passed IN by the caller (the overlay), never generated
// here, so the rules are unit-testable without mocking time.
//
// The one React export, `useCanvasComments`, binds the array to `__comments`
// via the SDK's `useFusedParam` against the page's top-level params store — the
// store the parley reporter and URL-sync already subscribe to. So a write here
// fans out to the agent (parley `params` event) and the URL (human durability)
// with no extra plumbing (json-ui-comments.md §4).

import { useCallback, useMemo } from "react";

import { useFusedParam } from "@fusedio/widget-sdk";

import {
  COMMENTS_PARAM,
  type CanvasComment,
  type CommentAuthor,
  type CommentReply,
} from "./canvas-types";

// ------------------------------------------------------------------ predicates

/** Blank = not a string, or only whitespace. Blank-content threads/replies are dropped. */
export function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function toAuthor(value: unknown): CommentAuthor {
  return value === "agent" ? "agent" : "human";
}

/** A finite number, else `fallback` (used to coerce timestamps; non-numeric → 0). */
function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// ------------------------------------------------------------------ normalize

function normalizeReply(raw: unknown): CommentReply | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (isBlank(r.content)) return null; // symmetric blank filter
  return {
    id:
      typeof r.id === "string" && r.id !== ""
        ? r.id
        : `reply-${toNumber(r.createdAt, 0)}`,
    content: (r.content as string).trim(),
    author: toAuthor(r.author),
    createdAt: toNumber(r.createdAt, 0),
  };
}

function normalizeOne(raw: unknown): CanvasComment | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (isBlank(c.content)) return null; // drop blank root threads
  const replies = Array.isArray(c.replies)
    ? c.replies.map(normalizeReply).filter((r): r is CommentReply => r !== null)
    : [];
  const out: CanvasComment = {
    id:
      typeof c.id === "string" && c.id !== ""
        ? c.id
        : `cmt-${toNumber(c.createdAt, 0)}`,
    content: (c.content as string).trim(),
    author: toAuthor(c.author),
    // Preserve all three statuses. This normalizer is the single source of truth
    // for comment shape and runs on EVERY read AND before EVERY write — so if it
    // doesn't know "in_progress" it silently downgrades it to "open", which makes
    // a human add/delete (which round-trips the whole array through here) clobber
    // the agent's in_progress task back to Queued. Keep "in_progress" intact.
    status:
      c.status === "resolved"
        ? "resolved"
        : c.status === "in_progress"
          ? "in_progress"
          : "open", // default open
    replies,
    createdAt: toNumber(c.createdAt, 0),
  };
  const updatedAt = optionalNumber(c.updatedAt);
  if (updatedAt !== undefined) out.updatedAt = updatedAt;
  if (typeof c.anchorId === "string" && c.anchorId !== "") {
    out.anchorId = c.anchorId;
    const ox = optionalNumber(c.offsetX);
    const oy = optionalNumber(c.offsetY);
    if (ox !== undefined) out.offsetX = ox;
    if (oy !== undefined) out.offsetY = oy;
  } else if (typeof c.anchorPath === "string" && c.anchorPath !== "") {
    // Non-canvas widget anchor (json-ui-comments.md §9). Mutually exclusive with
    // anchorId; offsets are px within the resolved widget node's box.
    out.anchorPath = c.anchorPath;
    const ox = optionalNumber(c.offsetX);
    const oy = optionalNumber(c.offsetY);
    if (ox !== undefined) out.offsetX = ox;
    if (oy !== undefined) out.offsetY = oy;
  }
  const x = optionalNumber(c.x);
  const y = optionalNumber(c.y);
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (c.resolvedBy === "human" || c.resolvedBy === "agent")
    out.resolvedBy = c.resolvedBy;
  const resolvedAt = optionalNumber(c.resolvedAt);
  if (resolvedAt !== undefined) out.resolvedAt = resolvedAt;
  return out;
}

/**
 * Coerce an unknown `__comments` value into a clean, sorted `CanvasComment[]`.
 * Not an array (or unparseable) → `[]`. Blank-content threads/replies dropped.
 * Missing `status` → "open". This is applied on every READ and before every
 * WRITE so junk can never round-trip in (json-ui-comments.md §2).
 */
export function normalizeComments(raw: unknown): CanvasComment[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasComment[] = [];
  for (const item of raw) {
    const n = normalizeOne(item);
    if (n) out.push(n);
  }
  return sortComments(out);
}

/** Stable order: createdAt asc (non-numeric → 0), codepoint tiebreak on id. */
export function sortComments(list: CanvasComment[]): CanvasComment[] {
  return [...list].sort((a, b) => {
    const ca = toNumber(a.createdAt, 0);
    const cb = toNumber(b.createdAt, 0);
    if (ca !== cb) return ca - cb;
    const ia = a.id ?? "";
    const ib = b.id ?? "";
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

// ------------------------------------------------------------------ mutators
// All mutators are immutable (return a new normalized+sorted array) and take any
// generated id / timestamp from the caller, so they stay pure & testable.

export function addComment(
  list: CanvasComment[],
  comment: CanvasComment,
): CanvasComment[] {
  return normalizeComments([...list, comment]);
}

export function editContent(
  list: CanvasComment[],
  id: string,
  content: string,
  updatedAt: number,
): CanvasComment[] {
  return normalizeComments(
    list.map((c) => (c.id === id ? { ...c, content, updatedAt } : c)),
  );
}

export function addReply(
  list: CanvasComment[],
  id: string,
  reply: CommentReply,
  updatedAt: number,
): CanvasComment[] {
  return normalizeComments(
    list.map((c) =>
      c.id === id
        ? { ...c, replies: [...(c.replies ?? []), reply], updatedAt }
        : c,
    ),
  );
}

export function resolveComment(
  list: CanvasComment[],
  id: string,
  by: CommentAuthor,
  at: number,
): CanvasComment[] {
  return normalizeComments(
    list.map((c) =>
      c.id === id
        ? {
            ...c,
            status: "resolved",
            resolvedBy: by,
            resolvedAt: at,
            updatedAt: at,
          }
        : c,
    ),
  );
}

export function reopenComment(
  list: CanvasComment[],
  id: string,
  at: number,
): CanvasComment[] {
  return normalizeComments(
    list.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, status: "open" as const, updatedAt: at };
      delete next.resolvedBy;
      delete next.resolvedAt;
      return next;
    }),
  );
}

export function deleteComment(
  list: CanvasComment[],
  id: string,
): CanvasComment[] {
  return normalizeComments(list.filter((c) => c.id !== id));
}

/**
 * Does the commit from `prev` → `next` represent a feedback WRITE — the gesture
 * that should START the feedback loop? True for exactly three writes
 * (json-ui-comments.md): (a) a NEW comment (an id not present in `prev`), (b) a
 * REOPEN (a comment whose status went `resolved` → not-resolved), or (c) a NEW
 * REPLY (a comment whose replies array grew). It is deliberately FALSE for
 * edit-content, resolve, delete, and a position/anchor-only drag — and false for
 * merely opening a pin to VIEW a thread (that doesn't commit at all). Used to
 * gate the host's `onRequestCommentMode(true)` so viewing never starts the loop.
 */
export function isFeedbackWrite(
  prev: CanvasComment[],
  next: CanvasComment[],
): boolean {
  const prevById = new Map(prev.map((c) => [c.id, c] as const));
  for (const c of next) {
    const before = prevById.get(c.id);
    // (a) NEW comment — an id that wasn't there before.
    if (!before) return true;
    // (b) REOPEN — status left "resolved" for open/in_progress.
    if (before.status === "resolved" && c.status !== "resolved") return true;
    // (c) NEW REPLY — the replies array grew.
    if ((c.replies?.length ?? 0) > (before.replies?.length ?? 0)) return true;
  }
  return false;
}

/**
 * Drop the node anchor of any comment whose `anchorId` is not in `knownIds` —
 * the comment degrades to its `x`/`y` (which creation always sets), never
 * disappears (json-ui-comments.md §2). Used on load against the current canvas.
 */
export function reanchor(
  list: CanvasComment[],
  knownIds: ReadonlySet<string>,
): CanvasComment[] {
  return normalizeComments(
    list.map((c) => {
      if (!c.anchorId || knownIds.has(c.anchorId)) return c;
      const next = { ...c };
      delete next.anchorId;
      delete next.offsetX;
      delete next.offsetY;
      return next;
    }),
  );
}

// ------------------------------------------------------------------ URL budget

/**
 * The URL carries the FULL thread set until the JSON would exceed `budgetBytes`,
 * then oldest *resolved* threads are dropped first (open threads never dropped),
 * oldest→newest, until under budget (json-ui-comments.md §4). The param/config
 * keep everything; only the manual-reload URL copy is lossy, and only for
 * already-resolved threads.
 */
export function capCommentsForUrl(
  list: CanvasComment[],
  budgetBytes: number,
): { kept: CanvasComment[]; dropped: number } {
  const sorted = sortComments(list);
  let kept = sorted;
  let dropped = 0;
  // Resolved threads, oldest first, are the drop candidates.
  const resolvedOldestFirst = sorted
    .filter((c) => c.status === "resolved")
    .map((c) => c.id);
  let i = 0;
  while (
    JSON.stringify(kept).length > budgetBytes &&
    i < resolvedOldestFirst.length
  ) {
    const dropId = resolvedOldestFirst[i++];
    kept = kept.filter((c) => c.id !== dropId);
    dropped++;
  }
  return { kept, dropped };
}

// ------------------------------------------------------------------ the hook

export interface CanvasCommentsApi {
  comments: CanvasComment[];
  /** Replace the whole array (normalized + sorted) and broadcast immediately. */
  commit(next: CanvasComment[]): void;
}

/**
 * Bind the comment array to the canvas-level `__comments` param. Reads are
 * normalized; `commit` normalizes + sorts and sets the value — `setValue`
 * broadcasts the new array to the param store on the next tick (debounceMs:0),
 * which fans out to the parley reporter (-> agent) and URL-sync (-> human).
 *
 * NB: we deliberately do NOT call `broadcastNow()`. It broadcasts
 * `valueRef.current`, which is still the PREVIOUS value within this synchronous
 * tick (React has not re-rendered yet), AND it cancels the correct debounced
 * broadcast `setValue` just scheduled — so it would publish stale comments.
 * `setValue`'s own zero-delay timer broadcasts the right `next` value (captured
 * in its closure), which is both correct and prompt.
 *
 * `broadcastDefaultValue:false` because `__comments` is already seeded into the
 * store before mount by `harvestInitialParams` (data-store.ts) — a mount-time
 * default broadcast would be redundant and could surface as a spurious params
 * event to the agent.
 */
export function useCanvasComments(
  seed: CanvasComment[] | undefined,
): CanvasCommentsApi {
  const defaultValue = useMemo(() => normalizeComments(seed ?? []), [seed]);
  const { value, setValue } = useFusedParam<CanvasComment[]>({
    param: COMMENTS_PARAM,
    defaultValue,
    broadcastDefaultValue: false,
    // Comments are not free-text-typed into the param (the input holds local
    // draft state); each commit is a discrete structural change → no debounce.
    debounceMs: 0,
  });

  const comments = useMemo(() => normalizeComments(value), [value]);

  const commit = useCallback(
    (next: CanvasComment[]) => {
      setValue(normalizeComments(next));
    },
    [setValue],
  );

  return { comments, commit };
}
