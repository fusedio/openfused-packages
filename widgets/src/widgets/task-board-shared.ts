// task-board-shared.ts — the pure data + format layer shared by the task-board
// surfaces (list / kanban in task-board.tsx, the delegation tree in task-tree.*).
// Authored here, NOT lifted from app/ (the widgets package must not import app).
// Holds: the TaskStatus vocabulary, the client Task shape + row→Task coercion
// (seam ①), and the small pure formatters (taskLabel / statusLabel / timeAgo /
// feedbackBoardStem / deriveInitials). Extracting it keeps task-board.tsx and
// task-tree.tsx free of an import cycle (both depend on this leaf module).

// ─────────────────────────────────────────────────────────── status vocabulary
// Mirrors app/src/ui/lib/task-status.ts: the TaskStatus set + `statusLabel()`.
export const TASK_STATUSES = [
  "pending",
  "todo",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);

/** "in_progress" → "In Progress" (app statusLabel). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First non-empty line of a (possibly multi-line) task title (app taskDisplayTitle). */
export function taskDisplayTitle(title: string): string {
  return (
    title
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean) ?? title
  );
}

/** A feedback task (title `Feedback: <stem>`) targets the widget board `<stem>`
 * (app urls.ts § feedbackBoardStem). Null for any task with no associated board. */
export function feedbackBoardStem(title: string): string | null {
  const m = /^Feedback:\s*(.+)$/.exec(title);
  return m ? m[1].trim() : null;
}

// Run statuses that count as a "live" (in-flight) run for the live pulse, used
// only when the read UDF did not pre-derive the `isLive` scalar (seam ①).
export const LIVE_RUN_STATUSES = new Set(["running", "in_progress", "started"]);

export const UNASSIGNED_KEY = "__unassigned";

// ─────────────────────────────────────────────────────────────── row → Task
// Seam ① row shape. Rows arrive from DuckDB as `Record<string, unknown>`; coerce
// defensively (a `props.sql` override only has to keep the columns by name).
export interface Run {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  costUsd: number | null;
  usage: unknown;
}
export interface Task {
  id: string;
  project: string;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** parentId SKELETON for the delegation tree (spec/app-task-tree.md §1); null = root. */
  parentId: string | null;
  /** blockedBy ANNOTATION — the "waiting on" dependency edges (never a tree edge). */
  blockedBy: string[];
  runs: Run[];
  isLive: boolean;
  liveRunCount: number;
}

export function asStr(v: unknown, fallback = ""): string {
  return v === null || v === undefined ? fallback : String(v);
}
export function asNum(v: unknown, fallback = 0): number {
  const n = Number(v); // Number() converts bigint, numeric strings, and numbers alike
  return Number.isFinite(n) ? n : fallback;
}
export function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === "true" || v === "t";
}
export function asStatus(v: unknown): TaskStatus {
  const s = asStr(v);
  return TASK_STATUS_SET.has(s) ? (s as TaskStatus) : "pending";
}
export function parseRuns(v: unknown): Run[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      id: asStr(o.id),
      status: asStr(o.status),
      createdAt: asStr(o.createdAt),
      finishedAt: o.finishedAt == null ? null : asStr(o.finishedAt),
      costUsd: o.costUsd == null ? null : asNum(o.costUsd, 0),
      usage: o.usage,
    };
  });
}
/** Coerce a list column to a string[] — a real array, or a JSON-string array a
 * DuckDB list/JSON column may arrive as. Non-array / unparseable → []. */
export function parseStringArray(v: unknown): string[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => asStr(x)).filter((s) => s !== "");
}
export function toTask(row: Record<string, unknown>): Task {
  const runs = parseRuns(row.runs);
  // Prefer the pre-derived scalars (seam ①); fall back to scanning runs so the
  // live pulse still works against a hand-written `sql` override that omits them.
  const derivedLive = runs.filter((r) => LIVE_RUN_STATUSES.has(r.status));
  const hasIsLive = "isLive" in row;
  const hasLiveCount = "liveRunCount" in row;
  return {
    id: asStr(row.id),
    project: asStr(row.project),
    number: asNum(row.number),
    title: asStr(row.title),
    description: asStr(row.description),
    status: asStatus(row.status),
    agentId: row.agentId == null || row.agentId === "" ? null : asStr(row.agentId),
    createdBy: asStr(row.createdBy),
    createdAt: asStr(row.createdAt),
    updatedAt: asStr(row.updatedAt),
    parentId: row.parentId == null || row.parentId === "" ? null : asStr(row.parentId),
    blockedBy: parseStringArray(row.blockedBy),
    runs,
    isLive: hasIsLive ? asBool(row.isLive) : derivedLive.length > 0,
    liveRunCount: hasLiveCount ? asNum(row.liveRunCount) : derivedLive.length,
  };
}

// ───────────────────────────────────────────────────────────── small helpers
export function taskLabel(number: number): string {
  return `TASK-${String(number).padStart(2, "0")}`;
}
export function epoch(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}
// Ported 1:1 from app/src/ui/lib/timeAgo.ts (just now / m / h / d / w / mo).
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
export function timeAgo(iso: string): string {
  const then = epoch(iso);
  if (!then) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`;
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w ago`;
  return `${Math.floor(seconds / MONTH)}mo ago`;
}

/** "Ada Lovelace" → "AL"; a single name → its first two chars (app deriveInitials). */
export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Human-readable model label for an agent. `model` is nullable/optional: an
 * empty value means the agent inherits its adapter's default model, which the
 * agent-detail card renders as "default" — mirror that so every surface agrees
 * (twin of the app's `lib/agent-model.ts`). e.g. "sonnet-4.6", or "default".
 */
export function agentModelLabel(model: string | null | undefined): string {
  return (model ?? "").trim() || "default";
}
