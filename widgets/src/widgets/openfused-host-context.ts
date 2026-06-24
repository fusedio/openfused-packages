import { createContext, useContext } from "react";

/**
 * Host-capability context — non-SDK app capabilities a widget may use, supplied by
 * whatever host mounts the render surface (spec `packages/widgets/specs/surfaces.md`
 * §11; `spec/ui/ui-architecture.md` §13.3). This is the **general extension point**:
 * capabilities that have no `FusedWidgetBridge` namespace (navigation is not data /
 * param / UDF-shaped) ride this context instead of overloading the bridge.
 *
 * Every field is **optional and degrades gracefully** — a host that doesn't provide a
 * capability leaves it `undefined`, and a component reading it renders the inert
 * variant (e.g. a row that doesn't link), never a crash. New host capabilities (a
 * toast, an "open file", …) are added as more optional fields here, not as bespoke
 * seams. The package only **declares** the contract; the host (the `openfused up` app)
 * **provides** it — the same one-way layering as the bridge (no import from `app/`).
 */
export interface OpenfusedHost {
  /**
   * Navigate the host to an in-app path (browser route push on the app surface;
   * `undefined` on surfaces with no router — the deployed-serve bundle / parley
   * standalone). The general routing capability: any widget builds a path (from its
   * own route-template props) and calls this — the host owns the actual push.
   */
  navigate?: (path: string) => void;
  /**
   * Notify the host to **run an already-created task** — the dispatch seam. The task
   * itself is created by the `_core.task-management` CRUD UDFs (CRUD stays decoupled
   * from the host); spawning its run lives only in the app's Express dispatcher
   * (`startRun` → the §13.4 assignment wakeup), which the UDFs have no bridge to. The
   * caller creates the record, then calls this with the new id so the host *reacts*
   * and starts the run — the host creates nothing. Hosts without a dispatcher
   * (deployed-serve, parley) leave it `undefined`; the record persists and
   * boot-redispatch runs it later. Resolves `{}` on success, `{error}` on failure
   * (the record already exists, so the caller surfaces a recoverable warning).
   */
  runTask?: (taskId: string) => Promise<{ error?: string }>;
  /**
   * Open the host's New-task composer modal, optionally pre-filled (e.g. the agent
   * detail's "New task" pre-assigns this agent). The human then picks the project,
   * edits the draft, and submits — which routes through `createTask` above. Hosts
   * with no modal (deployed-serve, parley) leave it `undefined`; the caller falls
   * back to a `navigate` route. Prefer this over navigation on the app surface so the
   * composer opens in place with the agent already selected.
   */
  openNewTask?: (defaults?: {
    agentId?: string;
    title?: string;
    description?: string;
  }) => void;
}

export const OpenfusedHostContext = createContext<OpenfusedHost | null>(null);

/** Read the host capabilities; returns `{}` (all capabilities absent) off-host. */
export function useOpenfusedHost(): OpenfusedHost {
  return useContext(OpenfusedHostContext) ?? {};
}
