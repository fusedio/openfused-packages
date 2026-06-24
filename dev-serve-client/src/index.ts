import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

/**
 * `@fusedio/dev-serve-client` — the generic, project-ignorant client for the
 * shared `openfused dev serve` process (spec/dev-serve.md): a SINGLE multi-tenant
 * execution server a host OWNS — spawned lazily on first use, attached (killed on
 * host exit), respawned once after a crash. It replaces the per-project `widget
 * data-serve` daemons for project-rooted resolves: each request addresses its
 * `workspace + project` via query params, so one process serves every project
 * instead of one daemon per project.
 *
 * The project-LESS surfaces (`widget open <file>`, parley `path`/`config` pushes)
 * also route here, addressed by a loose DIRECTORY instead of a project:
 * `?dir=<abs>` (flat) or `?projectDir=<abs>` (skill-folder). See
 * `resolveWidgetDataDir` / `executeUdfDir` below — there is no separate standalone
 * daemon any more (spec/dev-serve.md, spec/feedback/local.md).
 *
 * The handshake token never leaves this process; the browser talks to the server
 * only through the host's proxy route.
 *
 * Leaf-library contract (spec/ui/widget-host-migration.md §1.1): this module
 * imports ONLY `node:child_process` + `node:readline` and uses the global
 * `fetch` (a Node 20+ global, not a module import) for HTTP (+ its own files).
 * It MUST NOT import from `app/`, `projects.ts`, `@fusedio/widgets`, or
 * `ui-kit`. Every
 * primitive here is string-addressed and env-ignorant — project resolution and
 * the 503 env pre-check are the host's responsibility at the call site.
 */

interface DevServe {
  origin: string;
  token: string;
  child: ChildProcess;
}

/** The single shared dev-serve process (lazily spawned, reused across projects). */
let devServe: Promise<DevServe> | null = null;
/** The live child, tracked synchronously so exit-time cleanup can't await. */
let devServeChild: ChildProcess | null = null;

const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * The command that runs the openfused CLI / MCP server. May contain arguments
 * ("uv run --project X openfused"). Inlined here (rather than imported from the
 * app's `paths.ts`) to keep the leaf-library contract — no `app/` imports.
 */
function openfusedCommand(): { command: string; args: string[] } {
  const raw = process.env.OPENFUSED_BIN ?? "openfused";
  const parts = raw.split(" ").filter(Boolean);
  return { command: parts[0], args: parts.slice(1) };
}

function spawnDevServe(): Promise<DevServe> {
  const { command, args } = openfusedCommand();
  const child = spawn(command, [...args, "dev", "serve"], {
    // Multi-tenant: no cwd pin and no OPENFUSED_PROJECT — every request carries
    // its own workspace+project and resolves its own env (spec/dev-serve.md).
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrTail: string[] = [];
  child.stderr!.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      stderrTail.push(line);
      if (stderrTail.length > 20) stderrTail.shift();
    }
  });
  devServeChild = child;
  child.on("exit", (code) => {
    console.log(`${new Date().toISOString()} dev serve exited (code ${code})`);
    if (devServeChild === child) devServeChild = null;
    devServe = null;
  });

  return new Promise<DevServe>((resolvePromise, rejectPromise) => {
    const rl = readline.createInterface({ input: child.stdout! });
    const timer = setTimeout(() => {
      rl.close();
      child.kill("SIGTERM");
      rejectPromise(
        new Error(
          `dev serve did not hand-shake within ${HANDSHAKE_TIMEOUT_MS / 1000}s — ` +
            `${stderrTail.join(" | ") || "no stderr"}`,
        ),
      );
    }, HANDSHAKE_TIMEOUT_MS);
    rl.once("line", (line) => {
      clearTimeout(timer);
      rl.close();
      try {
        const handshake = JSON.parse(line) as { origin?: string; token?: string };
        if (!handshake.origin || !handshake.token) throw new Error("incomplete handshake");
        console.log(
          `${new Date().toISOString()} dev serve up at ${handshake.origin} (pid ${child.pid})`,
        );
        resolvePromise({ origin: handshake.origin, token: handshake.token, child });
      } catch {
        child.kill("SIGTERM");
        rejectPromise(new Error(`dev serve handshake was not valid JSON: ${line}`));
      }
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectPromise(
        new Error(
          `failed to spawn dev serve (${command}): ${err.message} — ` +
            `is the openfused CLI on PATH? (set OPENFUSED_BIN to override)`,
        ),
      );
    });
  });
}

export async function ensureDevServe(): Promise<DevServe> {
  if (devServe) {
    const existing = await devServe.catch(() => null);
    if (existing && existing.child.exitCode === null) return existing;
    devServe = null;
  }
  const pending = spawnDevServe();
  devServe = pending;
  pending.catch(() => {
    devServe = null;
  });
  return pending;
}

/**
 * POST to the shared dev-serve process. `buildQuery` produces the addressing
 * query (alongside `?t=<token>`) — `workspace+project` for project resolves, or
 * `dir`/`projectDir` for the project-less surfaces — so the body is forwarded
 * verbatim and the token never leaves this process.
 *
 * One guard keeps a wedged child from surfacing as the cryptic "Unexpected
 * token 'I', \"Internal S\"…" JSON parse error: a NON-JSON response (an
 * unhandled-exception 500 yields a plain-text page, not an envelope) is
 * surfaced as a readable error rather than fed to JSON.parse.
 */
export async function runProxy(
  buildQuery: (token: string) => URLSearchParams,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const daemon = await ensureDevServe();
    try {
      const resp = await fetch(`${daemon.origin}${path}?${buildQuery(daemon.token).toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      // Clean responses are JSON (a {data,…} envelope or an {error} body); an
      // unhandled exception is a plain-text 500 page. Read as text then JSON.parse
      // so a non-JSON body becomes a readable error instead of crashing the proxy.
      const text = await resp.text();
      try {
        return { status: resp.status, payload: JSON.parse(text) };
      } catch {
        return {
          status: resp.status,
          payload: {
            error: `dev serve returned a non-JSON ${resp.status} response: ${
              text.trim().slice(0, 200) || "(empty body)"
            }`,
          },
        };
      }
    } catch (err) {
      // Connection failure (fetch/read threw) → the child is gone or wedged; reap
      // and retry once. A 500 *with* a body is handled above, not here.
      daemon.child.kill("SIGTERM");
      devServe = null;
      if (attempt === 1) throw new Error(`dev serve unreachable: ${(err as Error).message}`);
    }
  }
  throw new Error("unreachable");
}

/**
 * Proxy to dev serve addressed by a loose DIRECTORY — the project-less surfaces
 * (`widget open <file>`, parley `path`/`config`). `projectDir` (when set) selects
 * the skill-folder `?projectDir=` mode (scripts/ + project .venv); otherwise the
 * flat `?dir=` mode (udfs/ + inline sibling sources in the body). No env guard —
 * there is no project; the resolver lazily acquires the ambient/default env.
 */
export function proxyDevServeDir(
  dir: string,
  projectDir: string | null,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  return runProxy(
    (token) => {
      const q = new URLSearchParams({ t: token });
      if (projectDir) q.set("projectDir", projectDir);
      else q.set("dir", dir);
      return q;
    },
    path,
    body,
  );
}

/**
 * POST to dev serve addressed by an explicit `workspace + project` pair, taking
 * already-resolved STRING names. The single seam every project-aware or `_core`
 * caller goes through — the app's `proxyDevServe(ProjectSummary)` env-pre-check
 * wrapper (which stays app-side) and the `_core` helpers below all call this.
 */
export function postToDevServe(
  workspace: string,
  project: string,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  return runProxy((token) => new URLSearchParams({ t: token, workspace, project }), path, body);
}

/**
 * Resolve a widget-data body (first paint or `$param` change) for a project-less
 * directory — `widget open <file>` / parley `path`/`config`. Routes to dev serve's
 * `/api/exec/widget` dir mode. Body: `{ config, params?, only?, sources?, … }`.
 */
export function resolveWidgetDataDir(
  dir: string,
  projectDir: string | null,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  return proxyDevServeDir(dir, projectDir, "/api/exec/widget", body);
}

/**
 * Run one named UDF (`bridge.udfs.execute`) for a project-less directory — the
 * json-ui write seam for the `widget open` / parley surfaces. Routes to dev serve's
 * `/api/exec/udf` dir mode. Body: `{ udf, overrides, sources? }`.
 */
export function executeUdfDir(
  dir: string,
  projectDir: string | null,
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  return proxyDevServeDir(dir, projectDir, "/api/exec/udf", body);
}

/**
 * The built-in `_core` workspace (spec/core.md): a read-only, force-local set of
 * project UDFs `dev serve` resolves automatically (the venv is materialized at
 * dev-serve startup). It needs no env pin, so it skips any env guard and addresses
 * `?workspace=_core&project=<CORE_PROJECT>` directly.
 */
export const CORE_WORKSPACE = "_core";
const TASK_MANAGEMENT_PROJECT = "task-management";

/**
 * Resolve a built-in widget's data through the `_core` workspace instead of a
 * user host project (the Tasks / Secrets / Agent surfaces). Those widgets read
 * only fully-qualified `{{_core.*}}` refs, whose SOURCE dev serve resolves via its
 * `shared_roots` injection regardless of the addressed project — but a widget-data
 * resolve ships ONE resolver code string to ONE venv, and the ref still RUNS on
 * the addressed project's interpreter. So the resolve must be addressed at the
 * referenced project's venv: `_core.agents-management.read` imports pyyaml, which
 * is absent from `task-management`'s venv, so routing it through the canonical
 * project failed with "No module named 'yaml'". We derive the owning project from
 * the config's `{{_core.<project>.<udf>}}` refs (see `coreProjectFromConfig`),
 * falling back to `task-management` for a config with no — or more than one
 * distinct — `_core` ref. Mirrors the write path's `executeCoreUdf` /
 * `coreProjectFromUdf`. `_core` runs on a forced-local, env-independent backend
 * (its venv is materialized at dev-serve startup), so this skips any env guard.
 * Returns the raw `{status, payload}` envelope of `/api/exec/widget`, same shape
 * as the host's `resolveWidgetData`.
 */
export function resolveCoreWidgetData(
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  const project = coreProjectFromConfig(body) ?? TASK_MANAGEMENT_PROJECT;
  return postToDevServe(CORE_WORKSPACE, project, "/api/exec/widget", body);
}

/**
 * Derive the `_core` project that owns the UDF(s) a widget config READS, by
 * scanning its `{{_core.<project>.<udf>}}` SQL refs. The read/widget-data sibling
 * of `coreProjectFromUdf`: a widget-data resolve runs ONE resolver code string in
 * ONE venv, and a qualified `{{_core.proj.udf}}` ref RUNS on the addressed
 * project's interpreter (its source is found via `shared_roots`), so the resolve
 * must be addressed at the referenced project's venv. Returns the single
 * referenced project, or `null` when the config has no `_core` ref OR references
 * more than one distinct project — no single venv satisfies a multi-project
 * config, so the caller falls back to the canonical project. No built-in widget
 * reads across two `_core` projects today.
 */
export function coreProjectFromConfig(body: unknown): string | null {
  let json: string;
  try {
    json = JSON.stringify((body as { config?: unknown } | null)?.config ?? null);
  } catch {
    return null;
  }
  if (typeof json !== "string") return null;
  const re = /\{\{\s*_core\.([^.}\s?]+)\./g;
  const projects = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) projects.add(match[1]);
  return projects.size === 1 ? [...projects][0] : null;
}

/**
 * Derive the `_core` project that OWNS a fully-qualified `_core.<project>.<udf>`
 * exec name. A UDF executes in the ADDRESSED project's materialized venv (dev
 * serve resolves the ref SOURCE via `shared_roots`, but runs it on the addressed
 * project's interpreter), so an exec must be addressed at its own project: the
 * secrets UDFs need `keyring`, agent UDFs their own deps — running them in another
 * core project's venv fails with a missing-dependency error. Returns null for a
 * bare/unqualified name (caller falls back to the canonical project).
 */
export function coreProjectFromUdf(udf: unknown): string | null {
  if (typeof udf !== "string") return null;
  const match = /^_core\.([^.]+)\./.exec(udf);
  return match ? match[1] : null;
}

/**
 * Run a built-in widget's event-triggered UDF (`bridge.udfs.execute`) through the
 * `_core` workspace — the write/exec seam for the secrets-manager (list/get/put/
 * delete), task-board, and agent-detail surfaces. The UDF is addressed at the
 * `_core` project named in its fully-qualified `_core.<project>.<udf>` name so it
 * runs in that project's venv (see `coreProjectFromUdf`); falls back to
 * `task-management` for a bare name. Same no-env-guard rationale as
 * `resolveCoreWidgetData`; returns the raw `{status, payload}` shape of the host's
 * `executeUdf`.
 */
export function executeCoreUdf(
  body: unknown,
): Promise<{ status: number; payload: unknown }> {
  const udf = (body as { udf?: unknown } | null)?.udf;
  const project = coreProjectFromUdf(udf) ?? TASK_MANAGEMENT_PROJECT;
  return postToDevServe(CORE_WORKSPACE, project, "/api/exec/udf", body);
}

/**
 * Env pin changed. dev serve resolves each request's env fresh from the
 * project's manifest, so the pin change is picked up on the next request with no
 * restart — this is a no-op, kept so callers (main.ts) need no change.
 */
export function stopDaemon(_projectName: string): void {}

/**
 * Host shutdown: take the shared dev-serve child down with us (spec acceptance §7.5).
 * Synchronous on purpose — callable from process "exit"/signal handlers.
 */
export function stopAllDaemons(): void {
  if (devServeChild) {
    devServeChild.kill("SIGTERM");
    devServeChild = null;
  }
  devServe = null;
}
