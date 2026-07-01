/**
 * Static FusedWidgetBridge for the openfused MCP-host bundle.
 *
 * The json-ui components only touch the host through the SDK's
 * `FusedWidgetBridge` (params, udfs, sql, template, …). The Fused workbench
 * provides a Jotai/DuckDB/fetcher-backed implementation; here — rendering a
 * single, self-contained widget inside an MCP Apps sandbox with no live canvas —
 * we provide a mostly read-only stub: UDF queries are no-ops and the SQL bridge
 * serves server-resolved rows from the reactive `WidgetDataStore`.
 *
 * The `params` sub-bridge IS a real in-memory reactive store (see
 * `createParamsStore`) so the input components are interactive: a select,
 * slider, or text-input broadcasts its value through `params.set`, and any
 * sibling subscribed via `params.subscribe`/`useFusedParam` re-reads it. There
 * is no canvas/UDF re-execution here — instead a bound-param change re-resolves
 * the affected queries server-side through the data store.
 */
import type {
  FusedWidgetBridge,
  ParameterMessageType,
  SqlQueryResult,
  VfsResolveRef,
  VfsResolveResult,
} from "@fusedio/widget-sdk";

import type { WidgetDataStore } from "./data-store";

const unsubscribe = () => {};

/**
 * Server-resolved query results, keyed by the resolver-stamped `_queryId`
 * (e.g. `"q0"`). Each entry is the `{ columns, rows }` the Python planner
 * produced by running the binding's DuckDB SQL with default params.
 */
export type WidgetData = Record<
  string,
  { columns?: readonly string[]; rows?: ReadonlyArray<Record<string, unknown>> }
>;

/** Per-queryId resolver error messages (a bad query never blanks the widget). */
export type WidgetErrors = Record<string, string>;

/**
 * The bridge params contract plus two session-facing extras (json-ui-local.md):
 *
 *   `snapshotAll()`  — a full dump of every param the store currently holds.
 *                      The session reporters read it to build event payloads
 *                      (debounced `params` events, `action` snapshots, the
 *                      `pagehide` close beacon).
 *   `subscribeAll()` — fires the callback on ANY `set`/`clear`, regardless of
 *                      name. The session params reporter debounces off it.
 *
 * Both extras are structurally invisible to the SDK, which only sees
 * `FusedWidgetBridge["params"]`.
 */
export type ParamsStore = FusedWidgetBridge["params"] & {
  snapshotAll(): Record<string, unknown>;
  subscribeAll(cb: () => void): () => void;
};

/**
 * A real in-memory reactive params store that satisfies `FusedWidgetBridge["params"]`.
 *
 * Backed by a `Map` of name→value plus a `Map` of name→subscriber-set. Matches
 * the SDK's `useFusedParam` contract: subscriber callbacks take no args and
 * re-read through `getSnapshot`, so `set`/`clear` only need to notify (never
 * pass the value). Notification iterates over a copy of the subscriber set so a
 * callback that unsubscribes mid-notify can't break iteration.
 */
export function createParamsStore(): ParamsStore {
  const values = new Map<string, unknown>();
  const subscribers = new Map<string, Set<() => void>>();
  // Global subscribers: fired on ANY set/clear (the session params reporter).
  // A separate set — name-keyed subscribers are unaffected.
  const allSubscribers = new Set<() => void>();

  const notify = (name: string) => {
    const set = subscribers.get(name);
    if (set) {
      // Copy so a callback that unsubscribes (or subscribes) during notify
      // doesn't mutate the set we're iterating.
      for (const cb of [...set]) cb();
    }
    // Same copy-before-notify discipline for the global set.
    for (const cb of [...allSubscribers]) cb();
  };

  const addSubscriber = (name: string, cb: () => void) => {
    let set = subscribers.get(name);
    if (!set) {
      set = new Set();
      subscribers.set(name, set);
    }
    set.add(cb);
    return () => {
      const current = subscribers.get(name);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) subscribers.delete(name);
    };
  };

  return {
    subscribe(name: string, cb: () => void) {
      return addSubscriber(name, cb);
    },
    getSnapshot(name: string) {
      return values.get(name);
    },
    subscribeMany(names: readonly string[], cb: () => void) {
      const unsubs = names.map((name) => addSubscriber(name, cb));
      return () => {
        for (const u of unsubs) u();
      };
    },
    getSnapshotMany(names: readonly string[]) {
      const out: Record<string, unknown> = {};
      for (const name of names) {
        if (values.has(name)) out[name] = values.get(name);
      }
      return out;
    },
    snapshotAll() {
      return Object.fromEntries(values);
    },
    subscribeAll(cb: () => void) {
      allSubscribers.add(cb);
      return () => {
        allSubscribers.delete(cb);
      };
    },
    set(name: string, value: unknown, _type?: ParameterMessageType) {
      values.set(name, value);
      notify(name);
    },
    clear(name: string) {
      values.delete(name);
      notify(name);
    },
  };
}

/** Best-effort local `$param` substitution over the values the template hook passes in. */
function substituteParams(
  template: unknown,
  paramValues: Record<string, unknown>,
  preserveMissing = false,
): string {
  if (typeof template !== "string")
    return template == null ? "" : String(template);
  return template.replace(/\$([a-zA-Z_][\w]*)/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(paramValues, key)) {
      const v = paramValues[key];
      return v == null ? "" : String(v);
    }
    return preserveMissing ? match : "";
  });
}

/**
 * Derive a nominal, single-token VFS filename from a placeholder's registry
 * `key`. For a bare `{{udf}}` the key equals the UDF name → returns `name`
 * unchanged (the common case stays `${name}.parquet`). For an override variant
 * the key is `computePlaceholderKey(name, overrides)` = `name#k=v&…`, whose
 * non-identifier chars (`#`, `=`, `&`, …) are mapped to `_` so the result is a
 * safe single token AND distinct per resolved override value — which is what
 * makes `processedSql` change when an override `$param` changes (see
 * `resolveVfsFilenames`). Identity for the bare case is the load-bearing
 * property: `keyToFilename("u", "u") === "u"`.
 */
function keyToFilename(key: string, name: string): string {
  if (key === name) return name;
  return key.replace(/[^A-Za-z0-9_]+/g, "_");
}

export interface StaticBridgeOptions {
  /**
   * The reactive widget-data store. `sql.query` reads through it:
   * `await store.ensureFresh(queryId)` then returns the rows/columns/error.
   * Created in `app`/`main` (which also owns the params store the store reads).
   */
  store: WidgetDataStore;
  /**
   * The params store the data-store reads for staleness/POST bodies. MUST be
   * the SAME instance the store was constructed with — the bridge exposes it as
   * `bridge.params` so input components broadcast through it and the store sees
   * those values via `getSnapshotMany`.
   */
  params: FusedWidgetBridge["params"];
  /**
   * The host's udf-exec endpoint that `bridge.udfs.execute` POSTs to — the
   * event-triggered write seam behind the SDK's `useUdfExecutor` (a button's
   * `executor` fires here). The `openfused up` app passes its
   * `/api/projects/:name/udf-exec` proxy URL; `execute` POSTs the
   * already-resolved overrides and returns the `{data, error}` envelope.
   *
   * Omitted on the read-only surfaces (the deployed-serve bundle, the MCP-Apps
   * sandbox): there is no local host to run a UDF, so `execute` degrades to a
   * structured error that `useUdfExecutor` surfaces as its error state — the
   * same graceful no-op posture as a null `ActionSink`. The transport lives
   * here (not in an app component) for symmetry with the data store's resolve
   * fetch, and so the app's UI layer stays fetch-free (its import-boundary gate).
   */
  execUrl?: string;
}

export function createStaticBridge(
  options: StaticBridgeOptions,
): FusedWidgetBridge {
  const { store, params, execUrl } = options;

  return {
    params,
    udfs: {
      // Interval-refetch re-render channel: the store fires these after each
      // timer-driven refetch so a subscribed `useDuckDbSqlQuery` re-reads the
      // freshly-resolved rows (the hook does not observe the store directly).
      // The UDF-name arg is ignored — the store notifies coarsely (see
      // `notifyOutputs`); a spurious re-read is a cheap cached `ensureFresh`.
      subscribeOutput: (_udfName, cb) => store.subscribeOutput(cb),
      // The `{{udf.col}}` grammar / select default snapshot is
      // best-effort-deferred for v0 — return undefined so callers fall back.
      getOutputSnapshot: () => undefined,
      requestReexecute: () => {},
      // Event-triggered execution (useUdfExecutor): POST the already-resolved
      // overrides to the host's udf-exec endpoint and pass its {data, error}
      // envelope straight through (a transport/non-JSON failure becomes a
      // structured error). With no execUrl (the read-only surfaces) it degrades
      // to a structured error so the press is a visible no-op, not a crash.
      execute: execUrl
        ? async (udfName, overrides, opts) => {
            try {
              const res = await fetch(execUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  opts?.format
                    ? { udf: udfName, overrides, format: opts.format }
                    : { udf: udfName, overrides },
                ),
                signal: opts?.signal,
              });
              const text = await res.text();
              try {
                return JSON.parse(text);
              } catch {
                return {
                  data: null,
                  error: `udf-exec returned a non-JSON ${res.status} response`,
                };
              }
            } catch (err) {
              return { data: null, error: (err as Error).message };
            }
          }
        : async () => ({
            data: null,
            error: "UDF execution is unavailable on this surface.",
          }),
    },
    node: {},
    edges: {
      startLoading: () => {},
      stopLoading: () => {},
    },
    routing: {
      subscribeAllowedSources: () => unsubscribe,
      getAllowedUdfNames: () => null,
      getAllowedSources: () => null,
    },
    sql: {
      /**
       * Async read through the reactive store. The SDK threads the node's
       * `_queryId` (via `JsonUiBindingContext`) into `opts.queryId`. We
       * `await store.ensureFresh(queryId)`, which: returns the cached rows when
       * the qid's params are unchanged, or coalesces a server re-resolve when a
       * bound param changed, then returns the freshly-resolved rows/columns/
       * error. The await is what keeps the SDK hook's `loading` flag true during
       * a refetch (`use-duckdb-sql.ts` holds `queryLoading` through it). Missing
       * id → empty result carrying any per-query error, never a throw.
       */
      query: async (_sql, opts): Promise<SqlQueryResult> => {
        return store.ensureFresh(opts?.queryId);
      },
      /**
       * Return a filename for EVERY requested ref so the SDK preprocessing
       * proceeds to `sql.query` instead of stalling in "loading". No DuckDB VFS
       * exists in the sandbox — the names are nominal (the planner already ran
       * the queries server-side), keyed by `ref.key` as the hook expects.
       *
       * REACTIVITY: for an override placeholder `{{udf?k=$param}}`, the param
       * appears ONLY in the override (not the SQL body), so `buildProcessedSql`
       * substitutes THIS filename — not the param value — into the SQL text. If
       * the filename were a constant `${name}.parquet`, `processedSql` would be
       * byte-identical before/after the override changes, React would bail the
       * `setProcessedSql` update, the query effect would never re-fire, and
       * `sql.query` → `store.ensureFresh` would never run → the qid would never
       * re-resolve despite being in the depMap. To close that gap we derive the
       * filename from `ref.key`, which encodes the RESOLVED override values
       * (`computePlaceholderKey(name, overrides)`): a bare `{{udf}}` (key ===
       * name) still yields `${name}.parquet` (no change for the common case),
       * while each distinct override value yields a distinct filename →
       * `processedSql` changes → the effect re-fires → `ensureFresh`
       * re-resolves the override-only qid. The filename is purely nominal (the
       * bridge's `sql.query` ignores the SQL text entirely), so varying it is
       * safe; it stays a valid single-token filename.
       */
      resolveVfsFilenames: async (
        refs: readonly VfsResolveRef[] | readonly string[],
      ): Promise<VfsResolveResult> => {
        const filenames = new Map<string, string>();
        for (const ref of refs) {
          if (typeof ref === "string") {
            filenames.set(ref, `${ref}.parquet`);
          } else {
            filenames.set(
              ref.key,
              `${keyToFilename(ref.key, ref.name)}.parquet`,
            );
          }
        }
        return { filenames };
      },
    },
    template: {
      render: async (template, paramValues, opts) => ({
        value: substituteParams(
          template,
          paramValues,
          opts?.preserveMissingParams,
        ),
        loading: false,
      }),
      renderLoading: (template, paramValues, opts) =>
        substituteParams(template, paramValues, opts?.preserveMissingParams),
      subscribe: () => unsubscribe,
    },
    uploads: {
      checkAccess: async () => ({ ok: true }),
    },
    signUrl: async (url: string) => ({ signed: url, needsSigning: false }),
    log: {
      log: () => {},
      subscribeLogs: () => unsubscribe,
      getLogsSnapshot: () => [],
      clearLogs: () => {},
    },
  };
}
