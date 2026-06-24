// widgets/agent-detail.tsx — a 1:1 replica of the app's per-agent detail page
// (the former React AgentDetailPage) as a JSON-UI widget. Same DOM + Tailwind
// classes + interactions (header / overview read+edit / runs / instructions),
// authored with the SAME ui-kit primitives the original used (Button, Input,
// Textarea) plus the shared Identity (avatar + name) — but wired to the packaged
// _core UDFs instead of REST:
//   • the agent row resolves via {{_core.agents-management.read?slug=…}}
//   • runs load lazily via an executor read of _core.task-management.read
//   • config/prompt saves fire _core.agents-management.update; that UDF returns the
//     patched record, which we reflect locally (mutate-then-reflect) — the upstream
//     read UDF takes no refresh kwarg, so we don't round-trip through the SQL plane.

import { z } from "zod";
import React from "react";
import { Pencil } from "lucide-react";
import {
  useDuckDbSqlQuery,
  useFusedWidgetBridge,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Button, Input, Textarea, cn } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { useOpenfusedHost } from "./openfused-host-context";
import { statusLabel, timeAgo, parseRuns, type Run } from "./task-board-shared";
import { Identity } from "./agent-identity";

const AGENT_READ_SQL = "SELECT * FROM {{_core.agents-management.read?slug=$agentSlug}}";
const CORE_AGENTS_UPDATE_REF = "_core.agents-management.update";
const CORE_TASKS_READ_REF = "_core.task-management.read";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

// Run-status badge colors (the subset from status-colors.ts the original StatusChip used).
const STATUS_BADGE: Record<string, string> = {
  started: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};
const STATUS_BADGE_DEFAULT = "bg-muted text-muted-foreground";

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_BADGE[status] ?? STATUS_BADGE_DEFAULT,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-sm text-foreground", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  );
}

interface AdapterOpt {
  id: string;
  label?: string;
  models: { id: string; label?: string; default?: boolean }[];
}

interface Agent {
  id: string;
  slug: string;
  name: string;
  title: string;
  role: string;
  description: string;
  adapter: string;
  model: string;
  prompt: string;
  builtin: boolean;
  createdAt: string;
}

function asStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function toAgent(row: Record<string, unknown> | undefined): Agent | null {
  if (!row) return null;
  return {
    id: asStr(row.id),
    slug: asStr(row.slug),
    name: asStr(row.name),
    title: asStr(row.title),
    role: asStr(row.role),
    description: asStr(row.description),
    adapter: asStr(row.adapter),
    model: asStr(row.model),
    prompt: asStr(row.prompt),
    builtin: row.builtin === true || row.builtin === "true",
    createdAt: asStr(row.createdAt),
  };
}

// The sensible default model for an adapter: its `default: true` entry, else ""
// (the empty "default" option) — matching the former NewAgentPage/AgentDetailPage,
// NOT simply the first model in the list.
function defaultModelFor(adapter: AdapterOpt | undefined): string {
  return adapter?.models.find((m) => m.default)?.id ?? "";
}

type Tab = "overview" | "runs" | "instructions";

interface AgentRun {
  run: Run;
  taskId: string;
  taskTitle: string;
}

// ----------------------------------------------------------------- props schema
export const agentDetailProps = z
  .object({
    agentSlug: z.string().optional().default("").describe("The agent slug (route-bound)."),
    sql: z
      .string()
      .optional()
      .default(AGENT_READ_SQL)
      .describe("Read SQL for the one agent row over _core.agents-management.read."),
    adapters: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().optional(),
          models: z
            .array(
              z.object({
                id: z.string(),
                label: z.string().optional(),
                default: z.boolean().optional(),
              }),
            )
            .optional()
            .default([]),
        }),
      )
      .optional()
      .default([])
      .describe("Adapter options (each with its model list) for the edit-mode dropdowns."),
    taskHref: z.string().optional().default("/tasks/:taskId").describe("Run-row click route template."),
    newTaskHref: z
      .string()
      .optional()
      .default("/tasks?agent=:slug")
      .describe("'New task' button route template (:slug interpolated)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type AgentDetailProps = z.infer<typeof agentDetailProps>;

// -------------------------------------------------------------------- component
function AgentDetail({ element }: ComponentRenderProps<AgentDetailProps>) {
  const {
    sql = AGENT_READ_SQL,
    adapters = [],
    taskHref = "/tasks/:taskId",
    newTaskHref = "/tasks?agent=:slug",
    style,
  } = element.props;
  const queryId = (element.props as { _queryId?: string })._queryId;
  const bridge = useFusedWidgetBridge();
  const { navigate, openNewTask } = useOpenfusedHost();

  const { rows, loading, error } = useDuckDbSqlQuery({ sql, queryId, enabled: !!sql });
  const resolved = React.useMemo(
    () => toAgent((rows as ReadonlyArray<Record<string, unknown>>)[0]),
    [rows],
  );
  // The agent row comes from the resolve. A save patches it through the update UDF,
  // which RETURNS the patched record — reflect that locally (`saved`) so the view
  // updates without a re-resolve (the upstream read UDF takes no refresh kwarg). A
  // fresh resolve (new `rows`, e.g. on navigation) supersedes the local copy.
  const [saved, setSaved] = React.useState<Agent | null>(null);
  React.useEffect(() => setSaved(null), [resolved]);
  const agent = saved ?? resolved;

  const [tab, setTab] = React.useState<Tab>("overview");

  // Runs: loaded once the agent is known (executor read of every task → filter to
  // this agent → flatten runs). Drives the Runs tab AND the Overview "Runs" stat.
  const [runs, setRuns] = React.useState<AgentRun[] | null>(null);
  React.useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    void bridge.udfs.execute(CORE_TASKS_READ_REF, {}).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e || !Array.isArray(data)) {
        setRuns([]);
        return;
      }
      const out: AgentRun[] = [];
      for (const t of data as Array<Record<string, unknown>>) {
        const aid = asStr(t.agentId);
        if (aid !== agent.id && aid !== agent.slug) continue;
        for (const run of parseRuns(t.runs)) {
          out.push({ run, taskId: asStr(t.id), taskTitle: asStr(t.title) });
        }
      }
      out.sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
      setRuns(out);
    });
    return () => {
      cancelled = true;
    };
  }, [agent, bridge]);

  const save = React.useCallback(
    async (patch: Partial<Agent>): Promise<boolean> => {
      const base = saved ?? resolved;
      if (!base) return false;
      const m = { ...base, ...patch };
      const { data, error: execError } = await bridge.udfs.execute(CORE_AGENTS_UPDATE_REF, {
        id: m.id,
        name: m.name,
        title: m.title,
        role: m.role,
        description: m.description,
        adapter: m.adapter,
        model: m.model,
        prompt: m.prompt,
      });
      if (execError) return false;
      // `update` returns the patched record (raw-return executor); reflect it, falling
      // back to the optimistic merge if the ack shape is unexpected.
      const record = Array.isArray(data) ? data[0] : data;
      setSaved(toAgent(record as Record<string, unknown> | undefined) ?? m);
      return true;
    },
    [saved, resolved, bridge],
  );

  if (error) {
    return <p className="mt-4 text-sm text-destructive">{error}</p>;
  }
  if (!agent) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {loading ? "Loading agent…" : "Agent not found."}
      </p>
    );
  }

  return (
    <div className="space-y-4" style={parseStyle(style)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Identity name={agent.name} size="lg" className="min-w-0" />
        {(openNewTask || navigate) && (
          <Button
            size="sm"
            onClick={() =>
              // Prefer the in-place composer pre-assigned to this agent (app surface);
              // fall back to the route when no host modal exists (deploy-serve / parley).
              openNewTask
                ? openNewTask({ agentId: agent.id })
                : navigate!(newTaskHref.replace(":slug", encodeURIComponent(agent.slug)))
            }
          >
            New task
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {(["overview", "runs", "instructions"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-sm capitalize transition-colors",
              tab === value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab agent={agent} adapters={adapters} runsCount={runs?.length ?? 0} onSave={save} />
      )}

      {tab === "runs" && (
        <div>
          {runs === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs yet for this agent.
            </p>
          ) : (
            <div className="border border-border">
              {runs.map(({ run, taskId, taskTitle }) => (
                <div
                  key={run.id}
                  onClick={navigate ? () => navigate(taskHref.replace(":taskId", encodeURIComponent(taskId))) : undefined}
                  className={cn(
                    "flex items-center gap-3 border-b border-border px-3 py-2 text-sm no-underline transition-colors last:border-b-0",
                    navigate && "cursor-pointer hover:bg-accent/30",
                  )}
                >
                  <StatusChip status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{taskTitle}</span>
                  <span className="w-20 text-right text-xs text-muted-foreground">
                    {run.createdAt ? timeAgo(run.createdAt) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "instructions" && <InstructionsEditor agent={agent} onSave={save} />}
    </div>
  );
}

// --------------------------------------------------------------- overview tab
function OverviewTab({
  agent,
  adapters,
  runsCount,
  onSave,
}: {
  agent: Agent;
  adapters: AdapterOpt[];
  runsCount: number;
  onSave: (patch: Partial<Agent>) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description);
  const [adapterType, setAdapterType] = React.useState(agent.adapter);
  const [model, setModel] = React.useState(agent.model ?? "");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setName(agent.name);
    setDescription(agent.description);
    setAdapterType(agent.adapter);
    setModel(agent.model ?? "");
  }, [agent]);
  React.useEffect(reset, [reset]);

  const adapter = adapters.find((a) => a.id === adapterType);
  const models = adapter?.models ?? [];
  const extraModel = model && !models.some((m) => m.id === model) ? model : null;

  const onAdapterChange = (type: string) => {
    setAdapterType(type);
    setModel(defaultModelFor(adapters.find((a) => a.id === type)));
  };

  const dirty =
    name.trim() !== agent.name ||
    description.trim() !== agent.description ||
    adapterType !== agent.adapter ||
    (model || "") !== (agent.model || "");
  const canSave = !!name.trim();

  const doSave = async () => {
    setSaving(true);
    setSaveError(null);
    const ok = await onSave({
      name: name.trim(),
      description: description.trim(),
      adapter: adapterType,
      model,
    });
    setSaving(false);
    if (ok) setEditing(false);
    else setSaveError("Save failed.");
  };

  if (!editing) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{agent.description}</p>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Configuration
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          <Stat label="Adapter" value={agent.adapter} mono />
          <Stat label="Model" value={agent.model || "default"} mono />
          <Stat label="Runs" value={String(runsCount)} />
          <Stat label="Created" value={agent.createdAt ? timeAgo(agent.createdAt) : "—"} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Adapter</label>
            <select
              value={adapterType}
              onChange={(e) => onAdapterChange(e.target.value)}
              className={SELECT_CLASS}
            >
              {adapter === undefined && (
                <option value={adapterType} className="bg-popover">
                  {adapterType}
                </option>
              )}
              {adapters.map((a) => (
                <option key={a.id} value={a.id} className="bg-popover">
                  {a.label || a.id}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className={SELECT_CLASS}>
              <option value="" className="bg-popover">
                default
              </option>
              {extraModel && (
                <option value={extraModel} className="bg-popover">
                  {extraModel}
                </option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id} className="bg-popover">
                  {m.label ?? m.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              reset();
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={!dirty || !canSave || saving} onClick={() => void doSave()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ instructions tab
function InstructionsEditor({
  agent,
  onSave,
}: {
  agent: Agent;
  onSave: (patch: Partial<Agent>) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState(agent.prompt);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(agent.prompt), [agent.prompt, agent.id]);

  const dirty = draft !== agent.prompt;
  const doSave = async () => {
    setSaving(true);
    setSaveError(null);
    const ok = await onSave({ prompt: draft });
    setSaving(false);
    if (!ok) setSaveError("Save failed.");
  };

  return (
    <div className="space-y-3">
      <Textarea
        rows={18}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="font-mono text-xs leading-relaxed"
      />
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(agent.prompt)}>
          Reset
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void doSave()}>
          {saving ? "Saving…" : "Save instructions"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Loading placeholder mirroring the agent-detail layout (header + tab bar +
 * overview card), shown by the app container while the host resolves + the first
 * data read lands (the `_core` read can take several seconds). Mirrors
 * `TaskBoardSkeleton`: pure shimmer blocks via `ofw-skeleton__shimmer`, no data.
 */
export function AgentDetailSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header: avatar + name, New task button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="ofw-skeleton__shimmer" style={{ height: 36, width: 36, borderRadius: 9999 }} />
          <div className="ofw-skeleton__shimmer" style={{ height: 20, width: 160, borderRadius: 6 }} />
        </div>
        <div className="ofw-skeleton__shimmer" style={{ height: 32, width: 96, borderRadius: 8 }} />
      </div>
      {/* Tab bar: overview / runs / instructions */}
      <div className="flex items-center gap-3 border-b border-border pb-2">
        {[64, 48, 96].map((w, i) => (
          <div key={i} className="ofw-skeleton__shimmer" style={{ height: 18, width: w, borderRadius: 6 }} />
        ))}
      </div>
      {/* Overview card: a couple of stat/field rows */}
      <div className="space-y-3 rounded-md border border-border p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="ofw-skeleton__shimmer" style={{ height: 12, width: 110, borderRadius: 4 }} />
            <div className="ofw-skeleton__shimmer" style={{ height: 16, width: `${70 - i * 12}%`, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: AgentDetail,
    props: agentDetailProps,
    description:
      "A 1:1 replica of the app's per-agent detail page as a widget: header (the agent Identity — avatar + name — and a New task button), an overview/runs/instructions tab bar, the overview config card with an Edit toggle (read Stats grid ⇄ edit form with adapter/model selects) + lifetime stats, the runs list with status chips, and the instructions prompt editor. Reads the agent via {{_core.agents-management.read}} SQL, loads runs via an executor read of _core.task-management.read, and saves config/prompt through the _core.agents-management.update executor seam (reflecting the UDF's returned record locally). New task opens the host's composer pre-assigned to this agent (the openNewTask host capability, falling back to a navigate route off-app); a run → its task uses the host navigate(path) capability.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
