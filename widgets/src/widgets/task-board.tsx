// widgets/task-board.tsx — the paperclip task-view as a single self-contained
// json-ui component: a LIST view and a KANBAN view of a project's (or all
// projects') tasks, with all of the controls held inside the component as client
// React state — search, status filter, group/sort, list⇄board toggle, and
// collapsible groups/lanes.
//
// This is the 4th Fused-OWNED primitive (after `button`, `video-review`,
// `canvas`): it is NOT in the Fused app, so it breaks paste-compatibility on
// purpose (spec/ui/json-ui.md § Authoring & catalog, ADR 0007). Full contract:
// packages/widgets/specs/widgets/task-board.md.
//
// ── DESIGN: PORTED 1:1 FROM THE APP ───────────────────────────────────────────
// The visual surface (toolbar, status filter, group/sort popover, list⇄board
// toggle, FilterBar chip strip, grouped list rows, the kanban columns + cards,
// the StatusIcon ring, the Identity avatar, the live pulse, the empty state) is a
// 1:1 copy of the app's task board — app/src/ui/components/{TasksList, KanbanBoard,
// TaskColumns, StatusIcon, Identity, FilterBar}.tsx + inbox/CollapseToggle.tsx,
// using the same @kit primitives, the same lucide icons, and the same Tailwind
// classNames. Where the app threads the router / roster / dnd-kit, the widget
// renders the same chrome without them (see read-only note below).
//
// ── SCOPE OF THIS FILE ──────────────────────────────────────────────────────
// The board reads task rows through `{{ref}}` SQL over the packaged
// `_core.task-management.read` UDF (`{{_core.task-management.read}}`) via the SDK's
// `useDuckDbSqlQuery` — the same resolve shortcut `metric` / `sql-table` use — and
// renders the full list + kanban with every CLIENT-SIDE control (filter / sort /
// group / collapse).
//
// The WRITE-PHASE UI is present and ported 1:1 from the app. Its mutating seams
// (`onMoveTask` / `onCreateTask` / `onAssignTask`) are WIRED through the GENERIC
// event-triggered executor — `bridge.udfs.execute` (spec/json-ui-app.md §11), the
// same seam a `button`'s `executor` prop fires. A move/cancel fires
// `_core.task-management.update_status`, a create fires `_core.task-management.create`
// (then `assign` if an assignee was picked, then a host run-spawn), and an assign
// fires `_core.task-management.assign`; each UDF writes the task store and returns an
// ack. On success the board bumps the `ofTasksRev` refresh param, which re-resolves
// the (read-only) read query — mutate-then-refetch (see the write-seam block above
// the props schema). The `_core.*` cross-project refs resolve only where the app's
// dev serve resolves them (the app is the only consumer). The host-effect seams
// that need a router are still no-ops here:
//   • the create-task composer (app NewTaskDialog) — full dialog UI, draft
//     persistence, ⌘↵ submit; submit → `onCreateTask` → a `create` mutation,
//   • drag-to-change-status (@dnd-kit) + the isHumanAllowedTransition guard — an
//     accepted move → `onMoveTask` → a `move` mutation (a refused move snaps back),
//   • click-through (`onOpenTask`) + the widget-board deep link (`onOpenBoard`) —
//     NO-OP (SPA navigation; the widget surface has no router — deferred),
//   • the `c` keyboard shortcut (open the composer).
// `TaskBoardView` is the surface-agnostic inner view; the outer component owns the
// read + the mutation-overlay wiring.
//
// Authored against `@fusedio/widget-sdk` (reads `element.props`, binds data via
// `useDuckDbSqlQuery`, styles via `parseStyle`) + `@fusedio/ui-kit` (`@kit`)
// for the dumb primitives, mirroring sql-table.tsx. `_queryId` is read off
// `element.props._queryId` (the resolver-stamped binding id).

import React from "react";
import { z } from "zod";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useDuckDbSqlQuery,
  useFusedWidgetBridge,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import {
  Button,
  Input,
  Badge,
  Dialog,
  DialogContent,
  DialogTitle,
  Popover,
  PopoverTrigger,
  PopoverContent,
  cn,
  issueStatusIcon,
  issueStatusIconDefault,
  AppWindow,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Columns3,
  Folder,
  Hourglass,
  Layers,
  Loader2,
  Network,
  Plus,
  RotateCcw,
  Search,
  User,
  X,
} from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Card, ErrorState } from "../components/card";

// ─────────────────────────────────────────────────────────── status vocabulary
// The TaskStatus vocabulary, the client Task shape + row→Task coercion (seam ①),
// and the pure formatters live in the leaf module task-board-shared.ts — shared
// with the delegation tree (task-tree.*) without an import cycle. Board-only lane
// order, sort order, paging constants and the human-transition guard stay here.
import {
  TASK_STATUSES,
  TASK_STATUS_SET,
  UNASSIGNED_KEY,
  statusLabel,
  taskDisplayTitle,
  feedbackBoardStem,
  taskLabel,
  timeAgo,
  epoch,
  toTask,
  type TaskStatus,
  type Task,
} from "./task-board-shared";
import { Identity } from "./agent-identity";
import { buildTaskForest, filterTaskForest, type TaskTreeNode } from "./task-tree";
import { useOpenfusedHost } from "./openfused-host-context";

/** Kanban lane order (same set/order as TASK_STATUSES). */
const boardStatuses = TASK_STATUSES;

/** Statuses that are cold / auto-collapsed in a high-volume board. */
const KANBAN_COLD_STATUSES = ["completed", "failed", "cancelled"] as const;

/** Board paging + high-volume threshold (app KanbanBoard constants). */
const KANBAN_BOARD_HIGH_VOLUME_THRESHOLD = 100;
const KANBAN_COLUMN_INITIAL_VISIBLE_LIMIT = 10;
const KANBAN_COLUMN_REVEAL_INCREMENT = 10;

// List grouping + status-sort order (app TasksList STATUS_ORDER — active first).
const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "blocked",
  "todo",
  "pending",
  "completed",
  "failed",
  "cancelled",
];
const STATUS_INDEX: Record<TaskStatus, number> = STATUS_ORDER.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<TaskStatus, number>,
);

/**
 * Whether a human (via the kanban drag) may move a task from `from` to `to`. Only
 * pending↔todo and "cancel anything" are hand-settable; every other lane is
 * reached by an agent run, not by hand. Advisory client mirror of the server's
 * authority (app task-status.ts § isHumanAllowedTransition).
 */
function isHumanAllowedTransition(from: string, to: string): boolean {
  return (
    (from === "pending" && to === "todo") ||
    (from === "todo" && to === "pending") ||
    to === "cancelled"
  );
}

/** Resolve the target lane for a kanban drop — `overId` is a lane status id or a
 * task id (inherit that task's status). App task-status.ts § resolveKanbanTargetStatus. */
function resolveKanbanTargetStatus(
  overId: string,
  tasks: ReadonlyArray<{ id: string; status: string }>,
): TaskStatus | null {
  if ((boardStatuses as readonly string[]).includes(overId)) {
    return overId as TaskStatus;
  }
  const status = tasks.find((t) => t.id === overId)?.status;
  return status && TASK_STATUS_SET.has(status) ? (status as TaskStatus) : null;
}

// The row→Task coercion (toTask), the Run/Task shapes and the small pure
// formatters (taskLabel / timeAgo / epoch / deriveInitials) now live in
// task-board-shared.ts (imported above).

// ─────────────────────────────────────────────────────────── view-state model
// All view chrome is local React state (spec § View-state model), persisted to
// localStorage per (project, surface). The surface id is not available to the
// read-only pass, so the key is scoped by project for now (matches today's
// per-scope saved prefs for the project-scoped vs global board).
type ViewMode = "list" | "board" | "tree";
type GroupBy = "none" | "status" | "assignee";
type SortField = "updated" | "created" | "title" | "status";
type SortDir = "asc" | "desc";

interface ViewState {
  viewMode: ViewMode;
  search: string;
  statuses: TaskStatus[];
  groupBy: GroupBy;
  sortField: SortField;
  sortDir: SortDir;
  collapsedGroups: string[];
}

const STORAGE_PREFIX = "openfused:tasks-view:";

function loadViewState(key: string, defaults: ViewState): ViewState {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    const merged = { ...defaults, ...parsed };
    // The list view + "none" grouping are retired — coerce any persisted prefs so an
    // old localStorage state can't strand the board on a view/group that's gone.
    if (merged.viewMode === "list") merged.viewMode = "board";
    if (merged.groupBy === "none") merged.groupBy = "status";
    return merged;
  } catch {
    return defaults;
  }
}

function useViewState(
  key: string,
  defaults: ViewState,
): readonly [ViewState, (patch: Partial<ViewState>) => void] {
  const defaultsRef = React.useRef(defaults);
  defaultsRef.current = defaults;
  const [state, setState] = React.useState<ViewState>(() =>
    loadViewState(key, defaults),
  );
  // Re-hydrate when the storage key (project) changes — separate saved prefs
  // per scope, matching the native dual global+project behaviour.
  React.useEffect(() => {
    setState(loadViewState(key, defaultsRef.current));
  }, [key]);
  const patch = React.useCallback(
    (p: Partial<ViewState>) => {
      setState((prev) => {
        const next = { ...prev, ...p };
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(
              STORAGE_PREFIX + key,
              JSON.stringify(next),
            );
          } catch {
            /* best-effort; a full/blocked store never breaks the board */
          }
        }
        return next;
      });
    },
    [key],
  );
  return [state, patch] as const;
}

// ───────────────────────────────────────────────────────────── leaf components
// StatusIcon — the bordered ring + inner dot for the terminal "completed" state
// (app StatusIcon.tsx). Non-interactive in the read-only board.
function StatusIcon({ status }: { status: TaskStatus }) {
  const colorClass = issueStatusIcon[status] ?? issueStatusIconDefault;
  const label = statusLabel(status);
  return (
    <span
      className={cn(
        "relative inline-flex h-4 w-4 rounded-full border-2 shrink-0",
        colorClass,
      )}
      aria-label={label}
      title={label}
    >
      {status === "completed" && (
        <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />
      )}
    </span>
  );
}

// LivePulse — the blue ping (app TaskRow/KanbanCard live indicator).
function LivePulse() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400">
      <span className="relative flex h-2 w-2">
        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
    </span>
  );
}

// CollapseToggle — the chevron shared by the list group headers (app inbox/CollapseToggle.tsx).
function CollapseToggle({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
  );
}

// ──────────────────────────────────────────────────────────────────── toolbar
function Toolbar({
  state,
  patch,
  onNewTask,
}: {
  state: ViewState;
  patch: (p: Partial<ViewState>) => void;
  onNewTask: () => void;
}) {
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [groupOpen, setGroupOpen] = React.useState(false);

  const toggleStatus = (s: TaskStatus) => {
    const has = state.statuses.includes(s);
    patch({
      statuses: has
        ? state.statuses.filter((x) => x !== s)
        : [...state.statuses, s],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative w-48 sm:w-64 md:w-80">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.search}
          onChange={(e) => patch({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          placeholder="Search tasks..."
          className="pl-7 text-xs sm:text-sm"
          aria-label="Search tasks"
        />
      </div>

      {/* Status filter */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
            <CircleDot className="h-3.5 w-3.5" />
            Status
            {state.statuses.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                {state.statuses.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50"
              onClick={() => toggleStatus(s)}
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center">
                {state.statuses.includes(s) && <Check className="h-3.5 w-3.5" />}
              </span>
              <StatusIcon status={s} />
              {statusLabel(s)}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Group / sort — grouping is status|assignee only (no "none"); hidden in tree
          view, which has no lanes/groups. */}
      {state.viewMode !== "tree" && (
        <Popover open={groupOpen} onOpenChange={setGroupOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <Layers className="h-3.5 w-3.5" />
              {`Group: ${state.groupBy}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1" align="start">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Group by
            </div>
            {(["status", "assignee"] as GroupBy[]).map((g) => (
              <button
                key={g}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50",
                  state.groupBy === g && "bg-accent",
                )}
                onClick={() => {
                  patch({ groupBy: g });
                  setGroupOpen(false);
                }}
              >
                {statusLabel(g)}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50"
              onClick={() =>
                patch({ sortDir: state.sortDir === "asc" ? "desc" : "asc" })
              }
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort {state.sortDir === "asc" ? "ascending" : "descending"}
            </button>
          </PopoverContent>
        </Popover>
      )}

      <div className="flex-1" />

      {/* Board / tree toggle (list view retired). */}
      <div className="flex items-center overflow-hidden rounded-md border border-border">
        <button
          className={cn(
            "flex h-8 items-center gap-1 px-2 text-xs transition-colors",
            state.viewMode === "board"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => patch({ viewMode: "board" })}
          aria-label="Board view"
        >
          <Columns3 className="h-3.5 w-3.5" /> Board
        </button>
        <button
          className={cn(
            "flex h-8 items-center gap-1 px-2 text-xs transition-colors",
            state.viewMode === "tree"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => patch({ viewMode: "tree" })}
          aria-label="Tree view"
        >
          <Network className="h-3.5 w-3.5" /> Tree
        </button>
      </div>

      {/* New Task — opens the create-task composer. */}
      <Button size="sm" className="h-8 gap-1 text-xs" onClick={onNewTask}>
        <Plus className="h-3.5 w-3.5" /> New Task
      </Button>
    </div>
  );
}

// active-filter chip strip (app FilterBar.tsx): status filter as removable chips.
function FilterBar({
  state,
  patch,
}: {
  state: ViewState;
  patch: (p: Partial<ViewState>) => void;
}) {
  if (state.statuses.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {state.statuses.map((s) => (
        <Badge key={s} variant="secondary" className="gap-1 pr-1">
          <span className="text-muted-foreground">Status:</span>
          <span>{statusLabel(s)}</span>
          <button
            className="ml-1 rounded-full hover:bg-accent p-0.5"
            onClick={() =>
              patch({ statuses: state.statuses.filter((x) => x !== s) })
            }
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-6"
        onClick={() => patch({ statuses: [] })}
      >
        Clear all
      </Button>
    </div>
  );
}

// Resolve a task's `agentId` to a display name. Provided by TaskBoardView from the
// roster (executor read); defaults to the identity (the raw id) off-host / before
// the roster loads, so the assignee chip degrades to the id rather than blanking.
const AgentNameContext = React.createContext<(id: string) => string>((id) => id);

// ────────────────────────────────────────────────────────────────── list view
// TaskRow (app TaskColumns.tsx / TaskRow). The router-backed <Link> is replaced by
// an onClick → `onOpenTask` seam; the per-row widget-board deep link (AppWindow +
// stem, derived from a `Feedback: <stem>` title) → `onOpenBoard`.
function TaskRow({
  task,
  onOpenTask,
  onOpenBoard,
}: {
  task: Task;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const stem = feedbackBoardStem(task.title);
  const agentName = React.useContext(AgentNameContext);
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 text-sm border-b border-border last:border-b-0 transition-colors",
        onOpenTask && "cursor-pointer hover:bg-accent/50",
      )}
      onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
    >
      <div className="flex items-center gap-2 shrink-0">
        <StatusIcon status={task.status} />
      </div>
      <div className="min-w-0 flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono shrink-0 relative top-[1px]">
          {taskLabel(task.number)}
        </span>
        <span className="truncate font-medium" title={task.title}>
          {task.title || "(untitled)"}
        </span>
        {task.isLive && <LivePulse />}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 shrink-0">
        {stem && onOpenBoard && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBoard(task.project, stem);
            }}
            title={`Open board ${stem}`}
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
          >
            <AppWindow className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden max-w-[10rem] truncate lg:inline">{stem}</span>
          </button>
        )}
        {task.agentId && (
          <Identity name={agentName(task.agentId)} size="sm" className="hidden sm:inline-flex" />
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {task.runs.length} run{task.runs.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted-foreground hidden md:inline whitespace-nowrap">
          {timeAgo(task.updatedAt)}
        </span>
      </div>
    </div>
  );
}

interface Group {
  key: string;
  label: string | null;
  status: TaskStatus | null;
  tasks: Task[];
  /** Set on assignee groups (the resolved agent name) so the header renders the
   * agent Identity (avatar + name) instead of plain text. */
  agentName?: string;
}

function ListView({
  groups,
  groupBy,
  collapsed,
  onToggle,
  onOpenTask,
  onOpenBoard,
}: {
  groups: Group[];
  groupBy: GroupBy;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isCollapsed = group.label != null && collapsed.has(group.key);
        return (
          <div key={group.key}>
            {group.label != null && (
              <button
                className="flex w-full items-center gap-2 rounded-t-md bg-muted/50 px-4 py-2 text-left"
                onClick={() => onToggle(group.key)}
              >
                <CollapseToggle expanded={!isCollapsed} />
                {groupBy === "status" && group.status && (
                  <StatusIcon status={group.status} />
                )}
                {group.agentName ? (
                  <Identity name={group.agentName} size="sm" />
                ) : (
                  <span className="text-sm font-medium">{group.label}</span>
                )}
                <span className="ml-1 text-xs text-muted-foreground">
                  {group.tasks.length}
                </span>
              </button>
            )}
            {!isCollapsed && (
              <div
                className={cn(
                  "border border-border",
                  group.label != null ? "rounded-b-md" : "rounded-md",
                )}
              >
                {group.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpenTask={onOpenTask}
                    onOpenBoard={onOpenBoard}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────── tree view
// Ported from app/src/ui/components/TaskTree.tsx (spec/app-task-tree.md §1/§2/§3).
// Draws the `parentId` delegation hierarchy as the SKELETON (indent +
// collapse/expand) and the `blockedBy` dependency edges as an OVERLAY (a
// "waiting on" badge) — never conflating the two: a `blockedBy` edge never moves
// a node. Hover/focus tints ONLY the pointed-at row; related blockers/dependents
// are shown by the badge, not by tinting other rows. Two adaptations from
// the app: its router <Link> + render-prop seams become the widget's onOpenTask /
// onOpenBoard callbacks (the same seam the list/board rows use), and the board-stem
// roll-up (rootBoardStem) walks the subtree for a `Feedback:` title since the widget
// has no precomputed boardByTask map (the app's root-only fallback).
const TREE_INDENT_PX = 20;

/** The blocker task ids that are not yet `completed` — the "waiting on" set (§2). */
function unresolvedBlockers(task: Task, byId: Map<string, Task>): string[] {
  return task.blockedBy.filter((id) => byId.get(id)?.status !== "completed");
}

/** Walk a node + its descendants and return the first board stem found (the ROOT
 * roll-up), so a pipeline shows exactly one "Open board" link on the user's parent
 * task. Null when no `Feedback: <stem>` title is found anywhere in the subtree. */
function rootBoardStem(node: TaskTreeNode): string | null {
  const stem = feedbackBoardStem(node.task.title);
  if (stem) return stem;
  for (const child of node.children) {
    const childStem = rootBoardStem(child);
    if (childStem) return childStem;
  }
  return null;
}

function TreeView({
  forest,
  tasks,
  liveTaskIds,
  collapsedIds,
  onToggleCollapsed,
  onOpenTask,
  onOpenBoard,
}: {
  forest: TaskTreeNode[];
  tasks: Task[];
  liveTaskIds: Set<string>;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  // Hovered/focused node → highlight its blockers AND dependents (§1, §2).
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const byId = React.useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  if (forest.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        No tasks to show in the tree.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {forest.map((node) => (
        <TreeRows
          key={node.task.id}
          node={node}
          byId={byId}
          liveTaskIds={liveTaskIds}
          collapsedIds={collapsedIds}
          onToggleCollapsed={onToggleCollapsed}
          activeId={activeId}
          onActivate={setActiveId}
          onOpenTask={onOpenTask}
          onOpenBoard={onOpenBoard}
        />
      ))}
    </div>
  );
}

/** A node row + its (recursively rendered) children when expanded. */
function TreeRows({
  node,
  byId,
  liveTaskIds,
  collapsedIds,
  onToggleCollapsed,
  activeId,
  onActivate,
  onOpenTask,
  onOpenBoard,
}: {
  node: TaskTreeNode;
  byId: Map<string, Task>;
  liveTaskIds: Set<string>;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const agentName = React.useContext(AgentNameContext);
  const { task, children, depth } = node;
  const hasChildren = children.length > 0;
  const collapsed = collapsedIds.has(task.id);
  const isLive = liveTaskIds.has(task.id);
  const isActive = activeId === task.id;
  const blockers = unresolvedBlockers(task, byId);
  const colorClass = issueStatusIcon[task.status] ?? issueStatusIconDefault;
  const isCompleted = task.status === "completed";

  // The widget board link is a ROOT-only roll-up (§3): child rows never render one.
  const boardStem = depth === 0 ? rootBoardStem(node) : null;

  return (
    <div>
      <div
        role={onOpenTask ? "button" : undefined}
        tabIndex={onOpenTask ? 0 : undefined}
        onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
        onKeyDown={
          onOpenTask
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenTask(task.id);
                }
              }
            : undefined
        }
        onMouseEnter={() => onActivate(task.id)}
        onMouseLeave={() => onActivate(null)}
        onFocus={() => onActivate(task.id)}
        onBlur={() => onActivate(null)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          // Hover/focus highlights the POINTED-AT row ONLY. Related blockers/
          // dependents are surfaced via the "waiting on" badge, never by tinting
          // other rows — so hover never reads as multiple rows changing (§2).
          onOpenTask && "cursor-pointer hover:bg-accent/50",
          isActive && "bg-accent/40",
        )}
      >
        {/* Indentation — the parentId skeleton (§1) shown by depth offset. */}
        {depth > 0 && (
          <span className="shrink-0" aria-hidden style={{ width: depth * TREE_INDENT_PX }} />
        )}

        {/* Collapse/expand caret (only when the node has children). */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleCollapsed(task.id);
            }}
            aria-label={collapsed ? "Expand subtasks" : "Collapse subtasks"}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}

        {/* Status dot — same vocabulary the list rows use; in_progress pulses. */}
        <span
          className={cn(
            "relative inline-flex size-4 shrink-0 rounded-full border-2",
            colorClass,
            task.status === "in_progress" && "motion-safe:animate-pulse",
          )}
          title={statusLabel(task.status)}
          aria-label={statusLabel(task.status)}
        >
          {isCompleted && (
            <span className="absolute inset-0 m-auto size-2 rounded-full bg-current" />
          )}
        </span>

        {/* TASK-NN */}
        <span className="relative top-[1px] shrink-0 font-mono text-xs text-muted-foreground">
          {taskLabel(task.number)}
        </span>

        {/* Title — first line only (full title is the tooltip). */}
        <span className="min-w-0 truncate font-medium" title={task.title}>
          {taskDisplayTitle(task.title)}
        </span>

        {/* Live pulse marker. */}
        {isLive && (
          <span className="relative flex size-2 shrink-0" aria-label="Running">
            <span className="absolute inline-flex size-full rounded-full bg-blue-400 opacity-75 motion-safe:animate-pulse" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
        )}

        {/* Blocked-by badge — only when a blocker is not yet completed (§2). */}
        {blockers.length > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            title="Blocked by an unfinished task"
          >
            <Hourglass className="size-3" />
            Waiting on{" "}
            {blockers.map((id) => taskLabel(byId.get(id)?.number ?? 0)).join(", ")}
          </span>
        )}

        <div className="flex-1" />

        {/* Root-only widget-board deep link → onOpenBoard (stop the row click). The
            blue AppWindow + stem-name "Open board" link, identical to the app's
            TreeBoardLinkButton / list rows. Only rendered when the host can navigate. */}
        {boardStem && onOpenBoard && (
          <button
            type="button"
            title={`Open board ${boardStem}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenBoard(task.project, boardStem);
            }}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
          >
            <AppWindow className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[10rem] truncate">{boardStem}</span>
          </button>
        )}

        {/* Assignee chip — resolved to the agent's name via the roster context. */}
        {task.agentId && (
          <Identity name={agentName(task.agentId)} size="sm" className="shrink-0 inline-flex" />
        )}

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {task.runs.length} run{task.runs.length === 1 ? "" : "s"}
        </span>
        <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground md:inline">
          {timeAgo(task.updatedAt)}
        </span>
      </div>

      {hasChildren && !collapsed && (
        <div>
          {children.map((child) => (
            <TreeRows
              key={child.task.id}
              node={child}
              byId={byId}
              liveTaskIds={liveTaskIds}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              activeId={activeId}
              onActivate={onActivate}
              onOpenTask={onOpenTask}
              onOpenBoard={onOpenBoard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────── kanban view
// KanbanCard (app KanbanBoard.tsx) — draggable via @dnd-kit useSortable. The
// router-backed task link is replaced by an onClick → `onOpenTask` seam (guarded
// while dragging); the per-card widget-board deep link → `onOpenBoard`.
function KanbanCard({
  task,
  isOverlay,
  onOpenTask,
  onOpenBoard,
}: {
  task: Task;
  isOverlay?: boolean;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const agentName = React.useContext(AgentNameContext);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const stem = feedbackBoardStem(task.title);
  const linkClassName = "block no-underline text-inherit";
  const body = (
    <>
      <div className="flex items-start gap-1.5 mb-1.5">
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {taskLabel(task.number)}
        </span>
        {task.isLive && <LivePulse />}
      </div>
      <p className="mb-2 text-sm leading-snug line-clamp-2">
        {task.title || "(untitled)"}
      </p>
      <div className="flex items-center gap-2 min-w-0">
        {task.agentId && <Identity name={agentName(task.agentId)} size="sm" />}
      </div>
    </>
  );

  // The card's widget-board deep link — sibling of the task-click wrapper (never
  // nested), mirroring the app. Derived from a `Feedback: <stem>` title.
  const widgetLink =
    onOpenBoard && stem ? (
      <button
        type="button"
        className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          onOpenBoard(task.project, stem);
        }}
        title={`Open board ${stem}`}
      >
        <AppWindow className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[12rem] truncate">{stem}</span>
      </button>
    ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "rounded-md border bg-card cursor-grab active:cursor-grabbing transition-shadow p-2.5",
        isDragging && !isOverlay && "opacity-30",
        isOverlay ? "shadow-lg ring-1 ring-primary/20" : "hover:shadow-sm",
      )}
    >
      <div
        className={linkClassName}
        onClick={() => {
          // Don't navigate on the click that ends a drag.
          if (onOpenTask && !isDragging) onOpenTask(task.id);
        }}
      >
        {body}
      </div>
      {widgetLink}
    </div>
  );
}

interface Lane {
  key: string;
  label: string;
  status: TaskStatus | null;
  tasks: Task[];
  /** Set on assignee swimlanes (the resolved agent name) so the header renders the
   * agent Identity (avatar + name) instead of plain uppercase text. */
  agentName?: string;
}

// KanbanColumn (app KanbanBoard.tsx) — the collapsed (cold/high-volume) vertical
// bar, the narrow-when-empty column, the "Show N more" paging, and the @dnd-kit
// droppable (status lanes only; assignee swimlanes are not drop targets).
function KanbanColumn({
  laneKey,
  status,
  label,
  agentName,
  tasks,
  collapsed,
  visibleCount,
  revealIncrement,
  onShowMore,
  onOpenTask,
  onOpenBoard,
}: {
  laneKey: string;
  status: TaskStatus | null;
  label: string;
  agentName?: string;
  tasks: Task[];
  collapsed: boolean;
  visibleCount: number;
  revealIncrement: number;
  onShowMore: () => void;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: laneKey,
    disabled: status == null,
  });

  const isEmpty = tasks.length === 0;
  const visibleTasks = collapsed ? [] : tasks.slice(0, visibleCount);
  const hiddenCount = Math.max(tasks.length - visibleTasks.length, 0);
  const nextRevealCount = Math.min(revealIncrement, hiddenCount);

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex h-full min-h-[220px] w-[52px] shrink-0 flex-col items-center rounded-md border border-border bg-muted/20 px-1.5 py-2 transition-colors",
          isOver && "bg-accent/50 ring-1 ring-primary/20",
        )}
        title={`${label}: ${tasks.length}`}
      >
        {status != null && <StatusIcon status={status} />}
        <span className="mt-2 [writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="mt-auto rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </div>
    );
  }

  const narrow = isEmpty && !isOver;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col shrink-0 transition-[width,min-width]",
        narrow ? "min-w-[48px] w-[48px]" : "min-w-[260px] w-[260px]",
      )}
      title={narrow ? `${label}: ${tasks.length}` : undefined}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-2 mb-1",
          narrow && "flex-col justify-center",
        )}
      >
        {status != null && <StatusIcon status={status} />}
        {narrow ? (
          <span className="mt-1 [writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        ) : (
          <>
            {agentName ? (
              <Identity name={agentName} size="sm" />
            ) : (
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
            )}
            <span className="text-xs text-muted-foreground/60 ml-auto tabular-nums">
              {tasks.length}
            </span>
          </>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto rounded-md p-1 space-y-1 transition-colors",
          isOver ? "bg-accent/40" : "bg-muted/20",
        )}
      >
        <SortableContext
          items={visibleTasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {visibleTasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              onOpenTask={onOpenTask}
              onOpenBoard={onOpenBoard}
            />
          ))}
        </SortableContext>
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-border bg-background/70 px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            onClick={onShowMore}
          >
            Show {nextRevealCount} more
          </button>
        ) : null}
        {tasks.length > 0 && (hiddenCount > 0 || tasks.length >= visibleCount) ? (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            Showing {visibleTasks.length} of {tasks.length}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function BoardView({
  tasks,
  groupBy,
  visibleStatuses,
  collapsedStatuses,
  onMoveTask,
  onOpenTask,
  onOpenBoard,
}: {
  tasks: Task[];
  groupBy: "status" | "assignee";
  visibleStatuses: TaskStatus[];
  collapsedStatuses: TaskStatus[];
  onMoveTask: (id: string, status: TaskStatus) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const agentName = React.useContext(AgentNameContext);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [visibleCountByLane, setVisibleCountByLane] = React.useState<
    Record<string, number>
  >({});
  const collapsedStatusSet = React.useMemo(
    () => new Set(collapsedStatuses),
    [collapsedStatuses],
  );
  const statusFilterSet = React.useMemo(
    () =>
      visibleStatuses && visibleStatuses.length > 0
        ? new Set(visibleStatuses)
        : null,
    [visibleStatuses],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Status lanes follow the canonical board order + honor the status filter;
  // assignee swimlanes are derived from whichever assignees are present,
  // "Unassigned" last (app KanbanBoard lanes).
  const lanes = React.useMemo<Lane[]>(() => {
    if (groupBy === "assignee") {
      const m = new Map<string, Task[]>();
      for (const t of tasks) {
        const k = t.agentId ?? UNASSIGNED_KEY;
        const list = m.get(k);
        if (list) list.push(t);
        else m.set(k, [t]);
      }
      return [...m.entries()]
        .sort((a, b) => {
          if (a[0] === UNASSIGNED_KEY) return 1;
          if (b[0] === UNASSIGNED_KEY) return -1;
          return 0;
        })
        .map(([k, ts]) => ({
          key: `assignee:${k}`,
          label: k === UNASSIGNED_KEY ? "Unassigned" : agentName(k),
          status: null,
          tasks: ts,
          agentName: k === UNASSIGNED_KEY ? undefined : agentName(k),
        }));
    }
    const byStatus = {} as Record<TaskStatus, Task[]>;
    for (const s of boardStatuses) byStatus[s] = [];
    for (const t of tasks) {
      if (byStatus[t.status]) byStatus[t.status].push(t);
    }
    return boardStatuses
      .filter((s) => !statusFilterSet || statusFilterSet.has(s))
      .map((s) => ({
        key: s,
        label: statusLabel(s),
        status: s,
        tasks: byStatus[s] ?? [],
      }));
  }, [agentName, groupBy, statusFilterSet, tasks]);

  const activeTask = React.useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) ?? null : null),
    [activeId, tasks],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    // Status moves only make sense when lanes are statuses; assignee swimlanes
    // have no status semantics, so drops there are no-ops (cards snap back).
    if (groupBy !== "status") return;
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const targetStatus = resolveKanbanTargetStatus(over.id as string, tasks);
    if (targetStatus && targetStatus !== task.status) {
      onMoveTask(taskId, targetStatus);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-4 -mx-2 px-2">
        {lanes.map((lane) => (
          <KanbanColumn
            key={lane.key}
            laneKey={lane.key}
            status={lane.status}
            label={lane.label}
            agentName={lane.agentName}
            tasks={lane.tasks}
            collapsed={lane.status != null && collapsedStatusSet.has(lane.status)}
            visibleCount={
              visibleCountByLane[lane.key] ?? KANBAN_COLUMN_INITIAL_VISIBLE_LIMIT
            }
            revealIncrement={KANBAN_COLUMN_REVEAL_INCREMENT}
            onShowMore={() =>
              setVisibleCountByLane((current) => ({
                ...current,
                [lane.key]:
                  (current[lane.key] ?? KANBAN_COLUMN_INITIAL_VISIBLE_LIMIT) +
                  KANBAN_COLUMN_REVEAL_INCREMENT,
              }))
            }
            onOpenTask={onOpenTask}
            onOpenBoard={onOpenBoard}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <KanbanCard task={activeTask} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────── new-task composer
// The seam-② host boundary: the inner view's write callbacks. They default to
// no-ops in this read pass; the write phase swaps the no-ops for the udfs-bridge
// mutate path + SPA navigation without touching the render.
interface CreateTaskInput {
  project: string;
  prompt: string;
  agent: string | undefined;
}
/** A minimal agent shape for the composer roster (app api Agent subset). */
interface ComposerAgent {
  id: string;
  slug: string;
  name: string;
}

const DRAFT_KEY = "openfused:task-draft";
const DEBOUNCE_MS = 800;
const MOBILE_DIALOG_HEIGHT =
  "calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)))";

interface TaskDraft {
  title: string;
  description: string;
  agentId: string;
  project: string;
}

function loadDraft(): TaskDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as TaskDraft) : null;
  } catch {
    return null;
  }
}
function saveDraft(draft: TaskDraft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}
function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// NewTaskDialog — the create-task composer (app NewTaskDialog.tsx). The dialog
// frame, the autosizing title textarea, the description editor, the footer
// project + assignee pickers, ⌘↵ submit, and localStorage draft persistence are
// ported 1:1. The async create mutation is STUBBED: submit calls `onSubmit`
// (a no-op seam here) then closes. The project list + agent roster are derived
// from the resolved task rows (stand-ins for `api.projects()` / `api.agents()`).
function NewTaskDialog({
  open,
  onOpenChange,
  projects,
  agents,
  defaultProject,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: string[];
  agents: ComposerAgent[];
  defaultProject: string;
  /** Resolves true once the write lands; the dialog stays open (draft intact) on a
   * falsy result so a failed create is not silently discarded. */
  onSubmit: (input: CreateTaskInput) => void | Promise<boolean>;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [selectedProject, setSelectedProject] = React.useState("");
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [projectOpen, setProjectOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const draftTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = React.useRef(false);

  // Restore draft / apply defaults when the dialog opens. The board's project (if
  // a single project, not "all") pre-seeds the picker; the draft's project only
  // restores when it is still a selectable project.
  React.useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (defaultProject) setSelectedProject(defaultProject);
    const draft = loadDraft();
    if (draft && draft.title.trim()) {
      setTitle(draft.title);
      setDescription(draft.description);
      setAgentId(draft.agentId);
      if (!defaultProject && draft.project) setSelectedProject(draft.project);
    }
  }, [open, defaultProject]);

  // Drop a stale/unselectable project once the list is known.
  React.useEffect(() => {
    if (!open || !selectedProject) return;
    if (!projects.includes(selectedProject)) setSelectedProject("");
  }, [open, projects, selectedProject]);

  // Default the assignee to the first agent in the roster.
  React.useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(agents[0]!.slug);
  }, [agents, agentId]);

  const scheduleSave = React.useCallback((draft: TaskDraft) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (draft.title.trim()) saveDraft(draft);
    }, DEBOUNCE_MS);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    scheduleSave({ title, description, agentId, project: selectedProject });
  }, [title, description, agentId, selectedProject, open, scheduleSave]);

  React.useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  function reset() {
    setTitle("");
    setDescription("");
    setAgentId("");
    setSelectedProject("");
    setAssigneeOpen(false);
    setProjectOpen(false);
    setSubmitting(false);
    initializedRef.current = false;
  }

  // Closing DISCARDS the draft — every open starts blank. Cancels the pending
  // debounced save first so it can't re-persist what we just cleared.
  const closeAndClear = React.useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    clearDraft();
    reset();
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSubmit = React.useCallback(async () => {
    const t = title.trim();
    if (!selectedProject || !t || submitting) return;
    const prompt = description.trim() ? `${t}\n\n${description.trim()}` : t;
    setSubmitting(true);
    // Close only after a successful mutate ack — a failed create keeps the dialog
    // open with the draft intact (onSubmit resolves false). A surface with no write
    // seam returns void → treated as success so the composer still closes.
    const ok = await onSubmit({
      project: selectedProject,
      prompt,
      agent: agentId || undefined,
    });
    if (ok === false) {
      setSubmitting(false);
      return;
    }
    closeAndClear();
  }, [agentId, closeAndClear, description, onSubmit, selectedProject, submitting, title]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const currentAgent = React.useMemo(
    () => agents.find((a) => a.slug === agentId || a.id === agentId) ?? null,
    [agents, agentId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) closeAndClear();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        style={
          { "--new-task-dialog-height": MOBILE_DIALOG_HEIGHT } as React.CSSProperties
        }
        className={cn(
          "flex h-[var(--new-task-dialog-height)] max-h-[var(--new-task-dialog-height)] flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-w-lg",
        )}
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting) {
            event.preventDefault();
            return;
          }
          // A click inside a portaled Popover (project / assignee picker) counts
          // as "outside" the dialog — don't let it close the composer.
          const target = event.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest("[data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
      >
        {/* Accessible title (Radix requires a DialogTitle); the visible header
            below is decorative, so this is screen-reader-only. */}
        <DialogTitle className="sr-only">New task</DialogTitle>
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
          <span className="text-sm font-medium text-muted-foreground">New task</span>
          {selectedProject && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
              {selectedProject}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <textarea
            className="w-full resize-none overflow-hidden bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/50"
            placeholder="Task title"
            rows={1}
            value={title}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
          />
          <textarea
            className="mt-2 min-h-[120px] w-full resize-none bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder='Add detail — e.g. "Load s3://…/trips.parquet, clean it, chart weekly revenue on the board"'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Footer toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2">
            {/* REQUIRED project picker */}
            <Popover open={projectOpen} onOpenChange={setProjectOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50",
                    selectedProject
                      ? "border-input"
                      : "border-dashed border-input text-muted-foreground",
                  )}
                >
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                  {selectedProject || "Project"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {projects.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No projects available
                  </p>
                ) : (
                  projects.map((p) => (
                    <button
                      key={p}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                        p === selectedProject && "bg-accent",
                      )}
                      onClick={() => {
                        setSelectedProject(p);
                        setProjectOpen(false);
                      }}
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{p}</span>
                      {p === selectedProject && (
                        <Check className="ml-auto h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>

            <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent/50">
                  {currentAgent ? (
                    <Identity name={currentAgent.name} size="sm" />
                  ) : (
                    <>
                      <User className="h-3.5 w-3.5 text-muted-foreground" /> Assign
                    </>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {agents.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No agents available
                  </p>
                ) : (
                  agents.map((agent) => (
                    <button
                      key={agent.id}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                        (agent.slug === agentId || agent.id === agentId) &&
                          "bg-accent",
                      )}
                      onClick={() => {
                        setAgentId(agent.slug);
                        setAssigneeOpen(false);
                      }}
                    >
                      <Identity name={agent.name} size="sm" />
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">⌘↵</span>
            <Button
              size="sm"
              disabled={!title.trim() || !selectedProject || submitting}
              onClick={handleSubmit}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────── pure inner view (②)
// The surface-agnostic view over an already-resolved task array. The write
// callbacks of the seam-② boundary (onMove / onCreate / onOpenTask) are NOT here
// yet — this read-only pass takes only the read result + an optional onCreateTask
// (design chrome). They wrap this view in the write phase without changing the
// render below.
/** In-widget loading skeletons (reuse the shared `.ofw-skeleton__shimmer` CSS so
 * the look matches every other widget and works standalone too). Shown while the
 * board's data is first resolving, in place of the old "Loading tasks…" text. */
function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden">
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="flex w-72 shrink-0 flex-col gap-2">
          <div className="ofw-skeleton__shimmer" style={{ height: 16, width: 110, borderRadius: 6 }} />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="ofw-skeleton__shimmer"
              style={{ height: 88, width: "100%", borderRadius: 10 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="ofw-skeleton__shimmer"
          style={{ height: 44, width: "100%", borderRadius: 8 }}
        />
      ))}
    </div>
  );
}

/**
 * The full task-board skeleton (toolbar bar + board columns) — the SAME look the
 * widget shows while loading, exported so the app host can render it
 * deterministically while the (slow) task feed is still resolving, instead of
 * mounting the widget with no data and flashing an empty board. spec/json-ui-app.md §12.
 */
export function TaskBoardSkeleton() {
  return (
    <div className="ofw-task-board flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="ofw-skeleton__shimmer" style={{ height: 32, width: 260, borderRadius: 8 }} />
        <div className="ofw-skeleton__shimmer" style={{ height: 32, width: 110, borderRadius: 8 }} />
        <div className="flex-1" />
        <div className="ofw-skeleton__shimmer" style={{ height: 32, width: 96, borderRadius: 8 }} />
      </div>
      <div className="min-h-0 flex-1">
        <BoardSkeleton />
      </div>
    </div>
  );
}

export function TaskBoardView({
  tasks,
  loading,
  error,
  project,
  defaultView,
  defaultGroupBy,
  fill = false,
  roster = [],
  onCreateTask,
  onMoveTask,
  onOpenTask,
  onOpenBoard,
}: {
  tasks: Task[];
  loading: boolean;
  error?: string;
  project: string;
  defaultView: ViewMode;
  defaultGroupBy: GroupBy;
  /** Fill the parent's height in board view (h-full) instead of the fixed 32rem. */
  fill?: boolean;
  /** The real agent roster (parent's executor read), for the composer assignee
   * picker. Empty → fall back to ids derived from the task rows. */
  roster?: ComposerAgent[];
  /** Seam ②: create-task submit — the parent fires the executor write seam
   * (`_core.task-management.create`, spec/json-ui-app.md §11) and resolves true on a
   * successful ack, so the composer closes only after the write lands. */
  onCreateTask?: (input: CreateTaskInput) => void | Promise<boolean>;
  /** Seam ②: kanban status move — the parent fires the executor write seam. */
  onMoveTask?: (id: string, status: TaskStatus) => void;
  /** Seam ④: click-through to a task. No-op stub here. */
  onOpenTask?: (taskId: string) => void;
  /** Seam ④: open a task's widget board. No-op stub here. */
  onOpenBoard?: (project: string, stem: string) => void;
}) {
  const defaults = React.useMemo<ViewState>(
    () => ({
      viewMode: defaultView,
      search: "",
      statuses: [],
      groupBy: defaultGroupBy,
      sortField: "updated",
      sortDir: "desc",
      collapsedGroups: [],
    }),
    [defaultView, defaultGroupBy],
  );
  const [state, patch] = useViewState(project || "all", defaults);

  // ── seam-② host effects ──────────────────────────────────────────────────
  const [newTaskOpen, setNewTaskOpen] = React.useState(false);

  // The kanban move applies the advisory human-allowed guard (pending↔todo /
  // cancel), mirroring the app container; the actual mutation is the `onMoveTask`
  // seam (the parent fires the executor write — mutate-then-refetch).
  const moveTask = React.useCallback(
    (id: string, target: TaskStatus) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      if (!isHumanAllowedTransition(task.status, target)) return;
      onMoveTask?.(id, target);
    },
    [tasks, onMoveTask],
  );
  // Pass the host nav callbacks straight through (each is undefined when the host
  // provides no `navigate`). The views render the click affordance ONLY when their
  // handler is present — off-host, rows are inert (no cursor/role/onClick) and the
  // board link is hidden (surfaces.md §11.2: render the inert variant, never a crash).
  const openTask = onOpenTask;
  const openBoard = onOpenBoard;

  // `c` opens the composer (app useKeyboardShortcuts) — suppressed while a text
  // input / textarea / contenteditable is focused, and never with a modifier.
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const t = event.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable)
          return;
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setNewTaskOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Composer roster + project list — derived from the resolved rows (stand-ins
  // for `api.projects()` / `api.agents()`; the write phase swaps in the real
  // queries). The board's own project (when a single project, not "all")
  // pre-seeds the picker.
  const composerProjects = React.useMemo(() => {
    const set = new Set<string>();
    if (project && project !== "all") set.add(project);
    for (const t of tasks) if (t.project) set.add(t.project);
    return [...set].sort();
  }, [project, tasks]);
  // Composer roster: the real roster (`roster` prop — an executor read of the
  // packaged agents UDF, done by the parent which holds the bridge) when present,
  // else ids derived from the task rows so the composer still works off-host.
  const composerAgents = React.useMemo<ComposerAgent[]>(() => {
    if (roster.length > 0) return roster;
    const seen = new Set<string>();
    const out: ComposerAgent[] = [];
    for (const t of tasks) {
      if (t.agentId && !seen.has(t.agentId)) {
        seen.add(t.agentId);
        out.push({ id: t.agentId, slug: t.agentId, name: t.agentId });
      }
    }
    return out;
  }, [roster, tasks]);
  const composerDefaultProject = project && project !== "all" ? project : "";

  // Resolve a task's agentId → display name from the roster (both the agent id and
  // its slug map to the name, since a task's agentId may be either). Falls back to
  // the raw id when the roster is empty (off-host / pre-load).
  const agentNameFor = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const a of roster) {
      if (a.id) map.set(a.id, a.name || a.slug || a.id);
      if (a.slug) map.set(a.slug, a.name || a.slug);
    }
    return (id: string) => map.get(id) ?? id;
  }, [roster]);

  const deferredSearch = React.useDeferredValue(state.search);
  const collapsed = React.useMemo(
    () => new Set(state.collapsedGroups),
    [state.collapsedGroups],
  );
  const toggleCollapsed = React.useCallback(
    (key: string) => {
      const has = state.collapsedGroups.includes(key);
      patch({
        collapsedGroups: has
          ? state.collapsedGroups.filter((k) => k !== key)
          : [...state.collapsedGroups, key],
      });
    },
    [state.collapsedGroups, patch],
  );

  // filter (project scope + status + search) then sort — all client-side over the
  // resolved rows. A project-scoped board (`project !== "all"`) shows only that
  // project's tasks even when the read returns the global feed.
  const filtered = React.useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const statusSet = new Set(state.statuses);
    const scoped = project && project !== "all";
    const out = tasks.filter((t) => {
      if (scoped && t.project !== project) return false;
      if (statusSet.size > 0 && !statusSet.has(t.status)) return false;
      if (q && !`${t.title} ${t.description}`.toLowerCase().includes(q))
        return false;
      return true;
    });
    out.sort((a, b) => {
      let cmp: number;
      switch (state.sortField) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "status":
          cmp = STATUS_INDEX[a.status] - STATUS_INDEX[b.status];
          break;
        case "created":
          cmp = epoch(a.createdAt) - epoch(b.createdAt);
          break;
        case "updated":
        default:
          cmp = epoch(a.updatedAt) - epoch(b.updatedAt);
          break;
      }
      return state.sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [tasks, project, deferredSearch, state.statuses, state.sortField, state.sortDir]);

  // The delegation tree is built from the project-scoped FULL set (not the flat,
  // sorted `filtered`) so the parentId skeleton is complete, then ancestor-chain-
  // filtered (§4.1) by the same search + status predicates the list uses — a
  // matched child keeps its parents visible. The builder owns ordering (roots
  // newest-first, children oldest-first), so no flat sort is applied here.
  const treeForest = React.useMemo(() => {
    const scoped = project && project !== "all";
    const base = scoped ? tasks.filter((t) => t.project === project) : tasks;
    const forest = buildTaskForest(base);
    const q = deferredSearch.trim().toLowerCase();
    const statusSet = new Set(state.statuses);
    if (!q && statusSet.size === 0) return forest;
    return filterTaskForest(
      forest,
      (t) =>
        (statusSet.size === 0 || statusSet.has(t.status)) &&
        (!q || `${t.title} ${t.description}`.toLowerCase().includes(q)),
    );
  }, [tasks, project, deferredSearch, state.statuses]);

  // Tasks with an in-flight run drive the tree's live pulse (the board/list read
  // `task.isLive` per-row; the tree takes the id set).
  const liveTaskIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) if (t.isLive) s.add(t.id);
    return s;
  }, [tasks]);

  // grouping for the list view (app TasksList `grouped`)
  const groups = React.useMemo<Group[]>(() => {
    if (state.groupBy === "none") {
      return [{ key: "__all", label: null, status: null, tasks: filtered }];
    }
    if (state.groupBy === "status") {
      const byStatus = new Map<TaskStatus, Task[]>();
      for (const t of filtered) {
        const list = byStatus.get(t.status);
        if (list) list.push(t);
        else byStatus.set(t.status, [t]);
      }
      return STATUS_ORDER.filter((s) => byStatus.get(s)?.length).map((s) => ({
        key: s,
        label: statusLabel(s),
        status: s,
        tasks: byStatus.get(s)!,
      }));
    }
    // assignee
    const m = new Map<string, Task[]>();
    for (const t of filtered) {
      const k = t.agentId ?? UNASSIGNED_KEY;
      const list = m.get(k);
      if (list) list.push(t);
      else m.set(k, [t]);
    }
    return [...m.keys()].map((k) => ({
      key: k,
      label: k === UNASSIGNED_KEY ? "Unassigned" : agentNameFor(k),
      status: null,
      tasks: m.get(k)!,
      agentName: k === UNASSIGNED_KEY ? undefined : agentNameFor(k),
    }));
  }, [agentNameFor, filtered, state.groupBy]);

  // Board lane derivation: status lanes by default; assignee swimlanes when
  // grouped by assignee. High-volume auto-collapse of cold lanes only applies to
  // status lanes; an explicit status filter takes precedence (app TasksList).
  const boardGroupBy = state.groupBy === "assignee" ? "assignee" : "status";
  const boardHighVolume =
    state.viewMode === "board" &&
    filtered.length > KANBAN_BOARD_HIGH_VOLUME_THRESHOLD;
  const boardCollapsedStatuses: TaskStatus[] =
    boardHighVolume && boardGroupBy === "status" && state.statuses.length === 0
      ? [...KANBAN_COLD_STATUSES]
      : [];

  // ── content: error / empty (loading + no-tasks + no-match) / board / list ──
  let body: React.ReactNode;
  if (error) {
    body = <ErrorState message={error} />;
  } else if (loading && tasks.length === 0) {
    // First load (no data yet) → an IN-WIDGET skeleton matching the active view,
    // not a "Loading tasks…" text line. A re-resolve with data already on screen
    // keeps the board (handled by the branches below).
    body = state.viewMode === "board" ? <BoardSkeleton /> : <RowSkeleton />;
  } else if (state.viewMode === "tree" ? treeForest.length === 0 : filtered.length === 0) {
    // Shared empty state across all views (app TasksList) — a status filter that
    // matches nothing reads as "no tasks" rather than an empty board/list/tree. In
    // tree mode it gates on the (ancestor-kept) forest, not the flat `filtered`.
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <CircleDot className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          {tasks.length === 0
            ? "No tasks yet. Create one to get started."
            : "No tasks match your filters."}
        </p>
        {tasks.length === 0 && (
          <Button size="sm" variant="outline" onClick={() => setNewTaskOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Task
          </Button>
        )}
        {tasks.length > 0 && state.statuses.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => patch({ statuses: [] })}>
            <RotateCcw className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>
    );
  } else if (state.viewMode === "board") {
    body = (
      // Fixed 32rem by default; a full-height host (the app Tasks surface) sets
      // `fill` so the board takes the remaining height instead of clipping.
      <div className={cn("min-h-0", fill ? "flex-1" : "h-[32rem]")}>
        <BoardView
          tasks={filtered}
          groupBy={boardGroupBy}
          visibleStatuses={state.statuses}
          collapsedStatuses={boardCollapsedStatuses}
          onMoveTask={moveTask}
          onOpenTask={openTask}
          onOpenBoard={openBoard}
        />
      </div>
    );
  } else if (state.viewMode === "tree") {
    body = (
      <TreeView
        forest={treeForest}
        tasks={tasks}
        liveTaskIds={liveTaskIds}
        collapsedIds={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onOpenTask={openTask}
        onOpenBoard={openBoard}
      />
    );
  } else {
    body = (
      <ListView
        groups={groups}
        groupBy={state.groupBy}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onOpenTask={openTask}
        onOpenBoard={openBoard}
      />
    );
  }

  return (
    <AgentNameContext.Provider value={agentNameFor}>
      <div
        className={cn(
          "ofw-task-board",
          // Fill mode: a flex column that fills its (height-constrained) host so the
          // board body can take the remaining space; default keeps the block + gaps.
          fill ? "flex h-full min-h-0 flex-col gap-4" : "space-y-4",
        )}
      >
        <Toolbar state={state} patch={patch} onNewTask={() => setNewTaskOpen(true)} />
        <FilterBar state={state} patch={patch} />
        {body}
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          projects={composerProjects}
          agents={composerAgents}
          defaultProject={composerDefaultProject}
          onSubmit={(input) => onCreateTask?.(input)}
        />
      </div>
    </AgentNameContext.Provider>
  );
}

// ───────────────────────────────────────── writes via the executor seam (§11)
// Writes go through the GENERIC event-triggered executor — `bridge.udfs.execute`
// (the same seam a `button`'s `executor` prop fires; spec/json-ui-app.md §11), NOT
// the old read-SQL-path mutate hack. Writes fire the packaged `_core.task-management`
// CRUD UDFs directly, one per op (`update_status` / `create` / `assign`) with the
// mutation as typed overrides; each UDF writes through the in-sandbox `openfused`
// accessor and returns an ack. The executor is
// fire-and-forget, so on success the board bumps the `ofTasksRev` refresh param to
// re-resolve the (now read-only) READ query — mutate-then-refetch (§11: "the author
// wires a `$param` re-read"). `$ofTasksRev` is a STRICT ref kwarg (the resolver
// never defaults a $param ref arg — tests pin "ref args stay strict"), so the
// component keeps it set from mount ("0") and renders the pre-seed
// "missing parameter(s)" error as loading (see TaskBoard). No optimism: a card
// reflects a move only once the refetch lands; a write error leaves the prior state
// (the card snaps back) and surfaces the error.
const REFRESH_PARAM = "ofTasksRev";
const READ_SQL = "SELECT * FROM {{_core.task-management.read?rev=$ofTasksRev}}";

// The packaged `_core.task-management` CRUD UDFs (cross-project refs), fired
// directly per op. Create takes `title` (mapped from the composer's prompt);
// move/cancel both ride `update_status`; assign sets the task's `agentId`. The
// composer + reassign roster is an executor READ of the packaged agents UDF (the one
// resolve-plane query is already spent on the task read, so the roster rides the
// executor seam). These resolve only where `_core.*` cross-project refs resolve —
// the Fused app's dev serve.
const CORE_CREATE_REF = "_core.task-management.create";
const CORE_UPDATE_STATUS_REF = "_core.task-management.update_status";
const CORE_ASSIGN_REF = "_core.task-management.assign";
const CORE_AGENTS_READ_REF = "_core.agents-management.read";

/** One board mutation (seam ⑤), passed to the executor as the overrides map. */
interface Mutation {
  op: "move" | "cancel" | "create" | "assign";
  id?: string;
  status?: TaskStatus;
  prompt?: string;
  agentId?: string;
  project?: string;
}

// ───────────────────────────────────────────────────────────── props schema
export const taskBoardProps = z
  .object({
    project: z
      .string()
      .optional()
      .default("all")
      .describe(
        'Project name to scope the board to, or "all" for every project.',
      ),
    sql: z
      .string()
      .optional()
      .default(READ_SQL)
      .describe(
        "Read SQL over the packaged `_core.task-management.read` UDF (read-only). The default carries the `rev` refresh ref kwarg (`{{_core.task-management.read?rev=$ofTasksRev}}`) that the board bumps after each write to re-resolve (mutate-then-refetch) — keep that kwarg in any override or the board stops refreshing after writes. An override must also keep the task row columns (id, number, title, status, agentId, updatedAt, …) — the list/kanban read them by name. Writes do NOT ride this query; they fire the `_core.task-management.update_status` / `create` / `assign` UDFs through the executor seam. Resolves only where `_core.*` cross-project refs resolve (the app's dev serve).",
      ),
    defaultView: z
      .enum(["list", "board", "tree"])
      .optional()
      .default("board")
      .describe(
        "Initial view before any persisted localStorage state: list, kanban board, or the parentId delegation tree.",
      ),
    defaultGroupBy: z
      .enum(["none", "status", "assignee"])
      .optional()
      .default("status")
      .describe("Initial grouping before persisted state."),
    fill: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, the board view fills its parent's height (h-full) instead of the default fixed 32rem — set by a full-height host (the app's Tasks surface). The list/tree views always flow.",
      ),
    taskHref: z
      .string()
      .optional()
      .default("/tasks/:taskId")
      .describe(
        "Route template for a task row click — :taskId is interpolated, then handed to the host's generic navigate(path) capability (OpenfusedHost, surfaces.md §11). Click-through only renders when a host provides navigate (the app surface); off-host the row is inert.",
      ),
    boardHref: z
      .string()
      .optional()
      .default("/projects/:project/widget/:stem")
      .describe(
        "Route template for a root task's widget-board link — :project and :stem are interpolated, then handed to the host's navigate(path). Only rendered when the host provides navigate.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type TaskBoardProps = z.infer<typeof taskBoardProps>;

// ──────────────────────────────────── outer component (read + write hack)
function TaskBoard({ element }: ComponentRenderProps<TaskBoardProps>) {
  const {
    project = "all",
    sql = READ_SQL,
    defaultView = "board",
    defaultGroupBy = "status",
    fill = false,
    taskHref = "/tasks/:taskId",
    boardHref = "/projects/:project/widget/:stem",
    style,
  } = element.props;
  const queryId = (element.props as { _queryId?: string })._queryId;
  const bridge = useFusedWidgetBridge();
  // Click-through rides the GENERIC host nav capability (OpenfusedHost.navigate,
  // surfaces.md §11). The widget builds a path from its route-template props; the
  // host (the app surface) performs the route push. When no host provides
  // `navigate` (deploy-serve / parley standalone) the callbacks are undefined →
  // rows render inert (the views gate the click affordance on their presence).
  const { navigate, runTask: hostRunTask } = useOpenfusedHost();
  const onOpenTask = React.useMemo(
    () =>
      navigate
        ? (id: string) => navigate(taskHref.replace(":taskId", encodeURIComponent(id)))
        : undefined,
    [navigate, taskHref],
  );
  const onOpenBoard = React.useMemo(
    () =>
      navigate
        ? (proj: string, stem: string) =>
            navigate(
              boardHref
                .replace(":project", encodeURIComponent(proj))
                .replace(":stem", encodeURIComponent(stem)),
            )
        : undefined,
    [navigate, boardHref],
  );

  const { rows, loading, error } = useDuckDbSqlQuery({
    sql,
    queryId,
    enabled: !!sql,
  });

  // Refresh nonce: bumped after each successful write to re-resolve the read query
  // (mutate-then-refetch). The effect seeds it onto the STRICT `ofTasksRev` ref
  // kwarg from mount (the resolver never defaults a $param ref arg, so an unset
  // param would error the read) — that mount write also drives the first resolve.
  const [rev, setRev] = React.useState(0);
  React.useEffect(() => {
    bridge.params.set(REFRESH_PARAM, String(rev));
  }, [bridge, rev]);

  // The real agent roster, loaded via an executor READ of the packaged agents
  // UDF (off-host surfaces where `_core.*` refs don't resolve get an empty roster
  // and the composer falls back to ids derived from the task rows). Re-read
  // when the feed re-resolves (`rev`) so a newly-created agent shows up.
  const [roster, setRoster] = React.useState<ComposerAgent[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    void bridge.udfs.execute(CORE_AGENTS_READ_REF, {}).then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return;
      setRoster(
        (data as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id ?? ""),
          slug: String(a.slug ?? a.id ?? ""),
          name: String(a.name ?? a.slug ?? a.id ?? ""),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, rev]);

  // Writes fire the generic executor seam (§11). A successful fire clears any prior
  // write error and bumps `rev` → the read re-resolves. A failed fire keeps the
  // error and does NOT refetch, so the board keeps showing the true (pre-write)
  // state — the moved card snaps back, no optimism.
  const [writeError, setWriteError] = React.useState<string | null>(null);
  // Fire one mutation through the executor; resolves true on a clean ack (and
  // refetches), false on error (keeping the prior state). Callers that need to gate
  // UI on the result (the create dialog) await it; the drag is fire-and-forget.
  const fireMutation = React.useCallback(
    async (mut: Mutation): Promise<boolean> => {
      let execError: string | undefined;
      // Fire the packaged _core.task-management CRUD UDFs directly, one per op.
      // create → create(id,project,title,description) then, if an assignee was
      //   picked, assign(newId, agentId) (the create ack carries the new id), then
      //   notify the host to spawn the run;
      // move/cancel → update_status(id,status) (cancel maps to "cancelled");
      // assign → assign(id, agentId).
      if (mut.op === "create") {
        const title = mut.prompt ?? "";
        // Forward the client-generated id as the idempotency key: the create UDF is
        // get-or-create on a supplied id, so a retried fire never duplicates the row.
        const created = await bridge.udfs.execute(CORE_CREATE_REF, {
          id: mut.id ?? "",
          project: mut.project ?? "",
          title,
          description: title,
        });
        if (created.error) {
          // The create itself failed: no task exists — keep the composer open so the
          // draft survives and a retry is the right move.
          setWriteError(created.error);
          return false;
        }
        // The record now EXISTS (created by the _core CRUD UDF — CRUD stays
        // decoupled from Express). Assign + run are best-effort follow-ups: a
        // failure must NOT report the op as failed (that reopens the composer → a
        // retry would duplicate the task). On any follow-up error we refresh (so
        // the new task appears) and surface a recoverable warning instead.
        const record = Array.isArray(created.data) ? created.data[0] : created.data;
        const newId = (record as { id?: string } | undefined)?.id;
        if (mut.agentId) {
          const assign = newId
            ? await bridge.udfs.execute(CORE_ASSIGN_REF, { id: newId, agent_id: mut.agentId })
            : { error: "the create ack carried no task id" };
          if (assign.error) {
            setWriteError(`Task created, but assigning it failed (${assign.error}). Assign it from the board.`);
            setRev((r) => r + 1);
            return true;
          }
        }
        // Spawning a run lives only in Express (startRun → the §13.4 assignment
        // wakeup); the _core UDFs have no bridge to it. So once the record exists
        // we NOTIFY the host to react to it and start the run — the host creates
        // nothing, it only dispatches the already-created task. Off-app
        // (deploy-serve / parley) there is no dispatcher, so the record simply
        // persists and boot-redispatch runs it on the next app start.
        if (newId && hostRunTask) {
          const { error: runErr } = await hostRunTask(newId);
          if (runErr) {
            setWriteError(`Task created, but starting it failed (${runErr}). It will run on the next app start.`);
            setRev((r) => r + 1);
            return true;
          }
        }
        setWriteError(null);
        setRev((r) => r + 1);
        return true;
      } else if (mut.op === "assign") {
        ({ error: execError } = await bridge.udfs.execute(CORE_ASSIGN_REF, {
          id: mut.id ?? "",
          agent_id: mut.agentId ?? "",
        }));
      } else {
        const status = mut.op === "cancel" ? "cancelled" : (mut.status ?? "");
        ({ error: execError } = await bridge.udfs.execute(CORE_UPDATE_STATUS_REF, {
          id: mut.id ?? "",
          status,
        }));
      }
      if (execError) {
        setWriteError(execError);
        return false;
      }
      setWriteError(null);
      setRev((r) => r + 1);
      return true;
    },
    [bridge, hostRunTask],
  );

  const onMoveTask = React.useCallback(
    (id: string, status: TaskStatus) => {
      void fireMutation({ op: "move", id, status });
    },
    [fireMutation],
  );
  // Returns the executor result so the create dialog closes only on a successful
  // ack (a failed create keeps the dialog open with the draft intact).
  const onCreateTask = React.useCallback(
    (input: CreateTaskInput): Promise<boolean> =>
      fireMutation({
        op: "create",
        id: crypto.randomUUID(),
        prompt: input.prompt,
        agentId: input.agent,
        project: input.project,
      }),
    [fireMutation],
  );

  const tasks = React.useMemo(
    () => (rows as ReadonlyArray<Record<string, unknown>>).map(toTask),
    [rows],
  );

  // Bootstrap-error suppression: before the mount broadcast, a pre-resolving
  // surface may have run q0 with $ofTasksRev unset → the strict
  // "missing parameter(s): ofTasksRev" error. That self-heals on the mount
  // re-resolve, so render it as loading, never as an error. A WRITE error takes
  // precedence; any OTHER read error (a real UDF failure) still surfaces.
  const isBootstrapError = !!error && error.includes(REFRESH_PARAM);
  const shownError =
    writeError ?? (isBootstrapError ? undefined : error ?? undefined);

  return (
    // Transparent + borderless so the board sits on the app background, matching
    // the agent UI (no distinct card panel).
    <Card
      className={cn("ofw-card--task-board", fill && "ofw-card--task-board-fill")}
      style={{ ...parseStyle(style), background: "transparent", border: "none" }}
    >
      <TaskBoardView
        tasks={tasks}
        loading={loading || isBootstrapError}
        error={shownError}
        project={project}
        defaultView={defaultView}
        defaultGroupBy={defaultGroupBy}
        fill={fill}
        roster={roster}
        onMoveTask={onMoveTask}
        onCreateTask={onCreateTask}
        onOpenTask={onOpenTask}
        onOpenBoard={onOpenBoard}
      />
    </Card>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: TaskBoard,
    props: taskBoardProps,
    description:
      "Fused task board — a list view, a kanban board, and a parentId delegation tree of a project's (or all projects') tasks, with search, status filter, group/sort, list/board/tree toggle, collapsible groups, drag-to-change-status, and a create-task composer, all held as client state. Reads task rows via {{ref}} SQL over the packaged _core.task-management.read UDF (read-only); writes (drag-to-move, create, assign) fire the _core.task-management update_status / create / assign UDFs through the generic event-triggered executor seam (bridge.udfs.execute), then bump a refresh param to re-resolve the read (mutate-then-refetch). Resolves only where _core.* cross-project refs resolve (the app's dev serve). Click-through (a task row → its detail, a root → its widget board) builds a path from the taskHref/boardHref route templates and calls the host's generic navigate(path) capability (OpenfusedHost, surfaces.md §11); surfaces with no host render the rows inert (non-linking). The assignee shows the raw agentId.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
