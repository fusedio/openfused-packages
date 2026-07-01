/**
 * Reactive widget-data store for the openfused MCP-host bundle ($param
 * reactivity over the channel).
 *
 * The server-resolved `data[queryId]` rows are injected once (from the
 * tool-result `structuredContent`) and the bridge's `sql.query` is normally a
 * pure lookup. This store makes inputs LIVE: picking a select value / dragging a
 * slider re-resolves ONLY the queries that depend on that param (server-side,
 * via the planner's widget-data endpoint) and swaps their rows in place.
 *
 * This store owns:
 *   - the mutable `{data, errors}` map keyed by `queryId`;
 *   - the `paramSnapshot` bookkeeping per qid (the param values its current rows
 *     were resolved with);
 *   - the inverted depMap (`qid -> [param names]`, built once);
 *   - the coalesced single-flight POST to `resolveUrl` with AbortController
 *     supersede (a newer snapshot aborts/ignores older in-flight responses).
 *
 * The bridge's `sql.query` calls `ensureFresh(queryId)` and awaits it before
 * returning rows; the SDK hook surfaces its `loading` flag while that awaits
 * (`use-duckdb-sql.ts` keeps `queryLoading` true through the await). The widget
 * stays mounted across a refetch — only the data identity changes, never the
 * config — so charts swap rows without unmount flicker.
 *
 * NOT reactive in the React-state sense: the data swap is observed by the SDK
 * hooks because a param change re-fires `useDuckDbSqlQuery`'s effect (its
 * `processedSql` / `queryId` change), which re-calls `sql.query`, which reads
 * the freshly-resolved rows out of this store. No React subscription needed.
 *
 * NOTE on openfused prop names: harvesting reads `props.param` + `props.defaultValue`
 * (openfused's input "initial value" prop is `defaultValue`); a data-bound node is
 * one the Python planner stamped with `props._queryId`.
 */
import type { FusedWidgetBridge, SqlQueryResult } from "@fusedio/widget-sdk";

import { COMMENTS_PARAM } from "./canvas/canvas-types";
import type { WidgetData, WidgetErrors } from "./static-bridge";

/** `{param -> [queryId, ...]}` — the planner's depMap shape (param-keyed). */
export type DepMap = Record<string, readonly string[]>;

type DataEntry = {
  columns?: readonly string[];
  rows?: ReadonlyArray<Record<string, unknown>>;
};

/** Shape of the widget-data endpoint response. */
interface ResolveResponse {
  data?: Record<string, DataEntry>;
  errors?: Record<string, string>;
}

/**
 * A param snapshot is a plain `{name: value}` map. We compare snapshots by a
 * stable string key (sorted entries, JSON-stringified values) so structural
 * equality — not reference identity — decides staleness.
 */
type ParamSnapshot = Record<string, unknown>;

function snapshotKey(snapshot: ParamSnapshot): string {
  const names = Object.keys(snapshot).sort();
  // JSON.stringify each value individually so `undefined` is preserved as the
  // literal token (JSON.stringify of a whole object drops undefined keys, which
  // would collapse "param present but undefined" and "param absent").
  return names
    .map((n) => `${n}=${JSON.stringify(snapshot[n]) ?? "undefined"}`)
    .join("");
}

/**
 * Initial-params harvesting (TS port; identical rule to the server planner).
 * Walk the config tree PRE-ORDER; for every node where `props.param` is a
 * non-empty string AND `props.defaultValue` is not undefined/null, record
 * `harvested[props.param] = props.defaultValue` (FIRST-SEEN wins).
 *
 * The planner merges `{...harvested, ...explicitParams}` (explicit wins) for
 * the initial server resolve; the bundle seeds its param store + per-qid
 * paramSnapshot from the SAME harvested map so the initial server data and the
 * post-mount param state match — no spurious refetch on first paint.
 *
 * KNOWN LIMITATION (component-level zod defaults are intentionally NOT
 * harvested): an input component may apply its OWN default (invisible to this
 * raw-JSON walk). For a bound input that OMITS `props.defaultValue`, the input still
 * broadcasts its own default on mount (`useFusedParam`, broadcastDefaultValue=
 * true) → the post-mount snapshot gains `{param: <componentDefault>}` while the
 * seeded snapshot had the param ABSENT → exactly ONE spurious re-resolve fires
 * on first paint. We do NOT harvest the component default here ON PURPOSE: the
 * SERVER planner likewise resolves with the param absent, so seeding the
 * component default bundle-side would make the seeded snapshot DISAGREE with the
 * data the server actually returned — trading one harmless extra fetch for a
 * data-correctness divergence (the chart would look "fresh" while showing rows
 * resolved WITHOUT the default). The extra fetch is what makes the displayed
 * data correct. Guidance: set `props.defaultValue` on bound inputs to avoid it.
 */
export function harvestInitialParams(config: unknown): Record<string, unknown> {
  const harvested: Record<string, unknown> = {};
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = node as Record<string, unknown>;
    const props = rec.props as Record<string, unknown> | undefined;
    if (props) {
      const param = props.param;
      const defaultValue = props.defaultValue;
      if (
        typeof param === "string" &&
        param !== "" &&
        defaultValue !== undefined &&
        defaultValue !== null &&
        !Object.prototype.hasOwnProperty.call(harvested, param) // first-seen wins
      ) {
        harvested[param] = defaultValue;
      }
      // Comments (json-ui-comments.md §6, §9): seed the page-level `__comments`
      // param from any node's `props.comments` HERE, before the parley/URL
      // reporters attach (main.tsx), so loading a config with comments fires no
      // spurious `params` event. Pre-order, so the ROOT's comments win — covers
      // both a canvas (`props.comments`) and a non-canvas root with page-level
      // comments. Carries no SQL → no depMap entry → a comment change resolves
      // nothing. First-seen wins.
      // Prefer the canonical `props.comments` seed; also accept `props.__comments`
      // (the live param key) so an agent that baked resolved comments back under
      // the param key still re-seeds correctly on push (the reply + resolved
      // state then show in the UI). First-seen wins.
      const commentSeed = Array.isArray(props.comments)
        ? props.comments
        : Array.isArray((props as Record<string, unknown>)[COMMENTS_PARAM])
          ? ((props as Record<string, unknown>)[COMMENTS_PARAM] as unknown[])
          : undefined;
      if (
        commentSeed &&
        !Object.prototype.hasOwnProperty.call(harvested, COMMENTS_PARAM)
      ) {
        harvested[COMMENTS_PARAM] = commentSeed;
      }
    }
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
  };
  visit(config);
  return harvested;
}

/**
 * Collect every `_queryId` the planner stamps into a config, mirroring the
 * Python planner's tree walk (`planner._iter_nodes` plus the map-layer / canvas
 * stamping): a node's own `props._queryId`, each `map`/`fused-map` layer's
 * `props.layers[]._queryId`, recursing the `children` subtree(s) and, for a
 * `canvas` node, each `props.nodes[].widget` subtree.
 *
 * `WidgetDataStore` uses this (when no explicit `queryIds` is given) to track
 * param-free queries — which are absent from the planner depMap — so they still
 * resolve on first paint. Tolerant of malformed / agent-authored input:
 * non-object nodes, missing/odd `props`, and non-array `children`/`layers`/
 * `nodes` are skipped rather than throwing. Deduped (a planner queryId is unique
 * per query).
 */
export function collectConfigQueryIds(config: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const props =
      rec.props && typeof rec.props === "object"
        ? (rec.props as Record<string, unknown>)
        : {};
    const qid = props._queryId;
    if (typeof qid === "string" && qid !== "") ids.add(qid);
    // map / fused-map: each data layer is stamped on the layer, not the node.
    if (rec.type === "map" || rec.type === "fused-map") {
      const layers = props.layers;
      if (Array.isArray(layers)) {
        for (const layer of layers) {
          if (layer && typeof layer === "object") {
            const lid = (layer as Record<string, unknown>)._queryId;
            if (typeof lid === "string" && lid !== "") ids.add(lid);
          }
        }
      }
    }
    // children: a list of nodes, or (defensively) a single node object.
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
    else if (rec.children && typeof rec.children === "object")
      visit(rec.children);
    // canvas: per-node widget subtrees live under props.nodes[].widget.
    if (rec.type === "canvas" && Array.isArray(props.nodes)) {
      for (const cn of props.nodes) {
        if (cn && typeof cn === "object")
          visit((cn as Record<string, unknown>).widget);
      }
    }
  };
  visit(config);
  return [...ids];
}

/**
 * Minimum refetch interval (ms). A 1s floor guardrails against per-tick Lambda
 * cost on deployed / shared dashboards: an author-supplied value below this is
 * clamped up rather than honored verbatim.
 */
export const MIN_REFRESH_INTERVAL_MS = 1000;

/**
 * Ceiling for the exponential backoff applied after a failed interval refetch:
 * the next attempt lands at `min(interval * 2 ** failures, MAX_BACKOFF_MS)`, so
 * a persistently-failing live source retries at most every 5 minutes rather
 * than hammering the resolver.
 */
export const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Harvest `{queryId -> intervalMs}` from a widget config, mirroring the
 * tree-walk of `collectConfigQueryIds` but recording each node's (and each
 * map/fused-map layer's) `refreshInterval` keyed by its `_queryId`.
 *
 * `refreshInterval` is author-authored — a trust boundary. Only a finite
 * `number > 0` yields an entry; a value in `(0, MIN_REFRESH_INTERVAL_MS)`
 * clamps up to the floor; everything else (missing, `<= 0`, `NaN`, non-number)
 * produces no entry, so those queries get no timer. Same defensive tree-walk as
 * `collectConfigQueryIds` (non-object nodes / odd props / non-array
 * children/layers/nodes are skipped, not thrown).
 */
export function collectRefreshIntervals(
  config: unknown,
): Record<string, number> {
  const out: Record<string, number> = {};
  const normalize = (v: unknown): number | undefined => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
    return v < MIN_REFRESH_INTERVAL_MS ? MIN_REFRESH_INTERVAL_MS : v;
  };
  const record = (qid: unknown, interval: unknown): void => {
    if (typeof qid !== "string" || qid === "") return;
    const ms = normalize(interval);
    if (ms !== undefined) out[qid] = ms;
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const props =
      rec.props && typeof rec.props === "object"
        ? (rec.props as Record<string, unknown>)
        : {};
    record(props._queryId, props.refreshInterval);
    // map / fused-map: each data layer is stamped on the layer, not the node.
    if (rec.type === "map" || rec.type === "fused-map") {
      const layers = props.layers;
      if (Array.isArray(layers)) {
        for (const layer of layers) {
          if (layer && typeof layer === "object") {
            const l = layer as Record<string, unknown>;
            record(l._queryId, l.refreshInterval);
          }
        }
      }
    }
    // children: a list of nodes, or (defensively) a single node object.
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
    else if (rec.children && typeof rec.children === "object")
      visit(rec.children);
    // canvas: per-node widget subtrees live under props.nodes[].widget.
    if (rec.type === "canvas" && Array.isArray(props.nodes)) {
      for (const cn of props.nodes) {
        if (cn && typeof cn === "object")
          visit((cn as Record<string, unknown>).widget);
      }
    }
  };
  visit(config);
  return out;
}

/**
 * Comment-loss guard for the agent push loop (json-ui-comments.md §4–5).
 *
 * On every agent `widget push` the page rebuilds its params store and reseeds
 * `__comments` from the PUSHED config's `props.comments` (main.tsx). That config
 * reflects only what the agent has seen — a comment the human added since the
 * last push lives ONLY in the page's live `__comments` param and would be
 * clobbered by the reseed. This merges the previous live comments FORWARD over
 * the config seed BY id so neither side is lost:
 *
 *   - id present in the CONFIG seed → use the config's version (the agent's
 *     resolved/in_progress state + appended replies win — it is the
 *     authoritative writer for ids it knows about);
 *   - id present ONLY in the previous live comments → KEEP it (a human comment
 *     the agent's push didn't carry — the one that was being lost).
 *
 * Order follows the config seed first (the agent's canonical ordering), then the
 * surviving live-only comments appended; downstream `normalizeComments` re-sorts
 * by `(createdAt, id)`, so the append order here is not load-bearing.
 *
 * Inputs are the raw param values (unknown). Non-array inputs are treated as
 * empty. Entries without a usable string `id` are passed through from whichever
 * side carries them (config first, then live) without dedup — id-less comments
 * can't be matched, so we never silently drop one.
 *
 * Returns `undefined` when there is nothing to seed (both sides empty/absent) so
 * the caller can leave `__comments` unseeded exactly as before — preserving the
 * "a canvas without comments harvests no `__comments` key" property.
 *
 * NOTE on human-deleted comments: deletion is a HUMAN action that writes the
 * live param, so a deleted comment is already absent from `prevLive`; it is not
 * resurrected here. A comment the human deleted that the AGENT still carries in
 * its (pre-deletion) pushed config WILL reappear from the config seed — that is
 * inherent to the reseed model (the agent hasn't seen the delete yet) and is out
 * of scope for this loss-fix; the next agent push that observes the deletion
 * drops it.
 */
export function mergeLiveComments(
  prevLive: unknown,
  configSeed: unknown,
): unknown[] | undefined {
  const live = Array.isArray(prevLive) ? prevLive : [];
  const seed = Array.isArray(configSeed) ? configSeed : [];
  if (live.length === 0 && seed.length === 0) return undefined;

  const idOf = (c: unknown): string | undefined => {
    if (!c || typeof c !== "object") return undefined;
    const id = (c as Record<string, unknown>).id;
    return typeof id === "string" && id !== "" ? id : undefined;
  };

  // Ids the config seed already covers — the agent's version of these wins.
  const seedIds = new Set<string>();
  for (const c of seed) {
    const id = idOf(c);
    if (id !== undefined) seedIds.add(id);
  }

  const merged: unknown[] = [...seed];
  for (const c of live) {
    const id = idOf(c);
    // Keep a live comment only if the config seed does NOT already carry its id.
    // (An id-less live comment can't be matched → keep it rather than drop it.)
    if (id === undefined || !seedIds.has(id)) merged.push(c);
  }
  return merged;
}

export interface WidgetDataStoreOptions {
  /** Planner-resolved initial rows keyed by `_queryId` (from structuredContent). */
  data?: WidgetData;
  /** Per-queryId resolver errors (from structuredContent). */
  errors?: WidgetErrors;
  /** `{param -> [queryId]}` dependency map from the planner. */
  depMap?: DepMap;
  /** Absolute widget-data endpoint URL for THIS widget. */
  resolveUrl?: string;
  /** The full widget config (POSTed back so the planner re-stamps the same qids). */
  config?: unknown;
  /**
   * Harvested `{param -> default}` the INITIAL server resolve used. Seeds every
   * qid's `paramSnapshot` so the post-mount default broadcast is a no-op
   * (current values already equal the snapshot → no spurious fetch).
   */
  harvestedParams?: Record<string, unknown>;
  /**
   * The query ids this store is responsible for resolving. Param-free queries
   * are absent from `depMap`, so the store tracks them from this set (or, when
   * omitted, from a walk of `config`) to make them eligible for first-paint
   * resolution. The canvas per-node store passes its OWN node's ids so it never
   * resolves another node's queries; the top-level store omits it and tracks the
   * whole config.
   */
  queryIds?: readonly string[];
  /**
   * The bridge's params store. The store reads current param values through
   * `params.getSnapshotMany` to detect staleness and to build the POST body.
   */
  params: FusedWidgetBridge["params"];
}

export class WidgetDataStore {
  private data: Record<string, DataEntry>;
  private errors: Record<string, string>;
  private readonly depMap: DepMap;
  private readonly resolveUrl?: string;
  private readonly config: unknown;
  private readonly params: FusedWidgetBridge["params"];

  /** Inverted depMap: `queryId -> [param names this qid depends on]`. */
  private readonly qidToParams: Record<string, string[]>;
  /** Union of every param name referenced by any binding (sorted, deduped). */
  private readonly allParamNames: string[];

  /**
   * Per-qid refetch interval (ms), harvested from the config and restricted to
   * the qids THIS store tracks. Consumed by the interval-refetch timer (next
   * task); a qid absent here has no timer.
   */
  private readonly refreshIntervals: Record<string, number>;

  /**
   * Per-qid: the snapshot KEY (stable string) the current rows were resolved
   * with. Seeded from `harvestedParams` so the first mount's default broadcasts
   * don't look stale.
   */
  private paramSnapshotKey: Record<string, string> = {};

  /** Single-flight: at most one POST in flight, keyed by its snapshot key. */
  private inflight: {
    snapKey: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null = null;

  /**
   * Qids force-marked stale by a timer tick (or visibility resume). `isStale`
   * returns true for a forced qid regardless of params/rows; `applyResponse` /
   * `applyEndpointError` clear it once the fetch is handled so it doesn't loop.
   */
  private forced = new Set<string>();

  /** Per-interval-qid `setTimeout` handle. Single-shot, rescheduled each tick. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Consecutive refetch-failure count per interval qid. Drives the backoff
   * delay in `scheduleTimer`; reset to 0 (deleted) by a successful
   * `applyResponse`. A manual param/write-driven failure does NOT reset it —
   * only a success does.
   */
  private failCounts = new Map<string, number>();

  /** Set once `dispose()` runs; guards every reschedule path. */
  private disposed = false;

  /** True while the page is hidden — timers are cleared and not rescheduled. */
  private hidden = false;

  /** True once `start()` has wired timers + the visibility listener (idempotent). */
  private started = false;

  /** Bound `visibilitychange` handler, retained so `dispose` can remove it. */
  private readonly onVisibilityChange = (): void => {
    if (this.disposed) return;
    const state =
      typeof document !== "undefined" ? document.visibilityState : "visible";
    if (state === "hidden") {
      this.hidden = true;
      this.clearTimers();
    } else {
      this.hidden = false;
      // Resume: refetch every interval qid once immediately, then reschedule.
      for (const qid of Object.keys(this.refreshIntervals)) this.forced.add(qid);
      void this.refetchStale();
      for (const qid of Object.keys(this.refreshIntervals)) this.scheduleTimer(qid);
    }
  };

  constructor(options: WidgetDataStoreOptions) {
    this.data = { ...(options.data ?? {}) };
    this.errors = { ...(options.errors ?? {}) };
    this.depMap = options.depMap ?? {};
    this.resolveUrl = options.resolveUrl;
    this.config = options.config;
    this.params = options.params;

    // Invert the depMap ONCE: param -> [qids] becomes qid -> [params].
    const qidToParams: Record<string, string[]> = {};
    const allNames = new Set<string>();
    for (const [param, qids] of Object.entries(this.depMap)) {
      allNames.add(param);
      for (const qid of qids) {
        (qidToParams[qid] ??= []).push(param);
      }
    }

    // Track EVERY query the config plans, not just the param-driven ones. A
    // param-free query never appears in depMap, so without this it is invisible
    // to computeStaleQids() AND isStale() short-circuits it to "fresh" — it would
    // never resolve. That is exactly the deployed-widget case: the serve plane
    // seeds `data` EMPTY ({}) and every query must resolve on first paint via a
    // single POST to resolveUrl. Seed an empty param list for each tracked qid
    // (an empty list keeps the "no params => never re-resolves on a param change"
    // semantics; the unresolved-rows check in isStale is what drives the first
    // fetch).
    //
    // The tracked set defaults to a walk of `config`, but a caller that owns only
    // a SUBSET passes `queryIds` explicitly — the canvas per-node store does this
    // so it only ever resolves its own node's queries (per-node isolation), never
    // another node's, even though every node is handed the full canvas config.
    const trackedQids = options.queryIds ?? collectConfigQueryIds(this.config);
    for (const qid of trackedQids) {
      if (!(qid in qidToParams)) qidToParams[qid] = [];
    }

    this.qidToParams = qidToParams;
    this.allParamNames = [...allNames].sort();

    // Harvest refetch intervals, restricted to the qids this store owns (the
    // qidToParams keys) — the canvas per-node store must not own another node's
    // intervals, matching the queryIds isolation enforced above.
    const allIntervals = collectRefreshIntervals(this.config);
    const refreshIntervals: Record<string, number> = {};
    for (const qid of Object.keys(qidToParams)) {
      if (qid in allIntervals) refreshIntervals[qid] = allIntervals[qid];
    }
    this.refreshIntervals = refreshIntervals;

    // Seed each qid's snapshot from the harvested defaults the initial server
    // resolve used. The snapshot key is computed over the qid's OWN params only
    // (restricted to harvested values), matching what `currentSnapshotFor`
    // reads after mount.
    const harvested = options.harvestedParams ?? {};
    for (const qid of Object.keys(this.qidToParams)) {
      this.paramSnapshotKey[qid] = snapshotKey(
        this.restrictToQid(qid, harvested),
      );
    }
  }

  /**
   * The harvested refetch interval (ms) for a qid this store owns, or
   * `undefined` when the qid has no configured interval (→ no timer). Consumed
   * by the interval-refetch timer (next task).
   */
  refreshIntervalFor(qid: string): number | undefined {
    return this.refreshIntervals[qid];
  }

  /** Build `{name: value}` over a qid's params, reading from a source map. */
  private restrictToQid(
    qid: string,
    source: Record<string, unknown>,
  ): ParamSnapshot {
    const names = this.qidToParams[qid] ?? [];
    const out: ParamSnapshot = {};
    for (const n of names) {
      // Only include names actually present in the source (mirrors
      // getSnapshotMany, which omits absent names) so harvested-vs-live keys
      // line up when a default is absent on both sides.
      if (Object.prototype.hasOwnProperty.call(source, n)) out[n] = source[n];
    }
    return out;
  }

  /** Current live param values for a single qid, read from the bridge store. */
  private currentSnapshotFor(qid: string): ParamSnapshot {
    const names = this.qidToParams[qid] ?? [];
    if (names.length === 0) return {};
    return this.params.getSnapshotMany(names);
  }

  /** A qid is stale if its current param values differ from the backing rows'. */
  private isStale(qid: string): boolean {
    // Force-stale: a timer tick / visibility-resume marks the qid so it
    // re-resolves even when its params are unchanged (the whole point of an
    // interval refetch). Cleared in applyResponse / applyEndpointError.
    if (this.forced.has(qid)) return true;
    // Fetch-on-mount: a query with no resolved rows AND no recorded error has
    // never been resolved, so it is stale regardless of params. This is what
    // makes a param-free query resolve on first paint when `data` was seeded
    // empty (the deployed serve plane). An errored qid has `data[qid]` set to an
    // empty entry (applyResponse / applyEndpointError) so it reads as resolved
    // here — we surface its error instead of re-fetching it on every render.
    if (this.data[qid] === undefined && this.errors[qid] === undefined)
      return true;
    // No params => never re-resolves on a param change (static / context-free).
    if ((this.qidToParams[qid] ?? []).length === 0) return false;
    const current = snapshotKey(this.currentSnapshotFor(qid));
    const backing = this.paramSnapshotKey[qid];
    return current !== backing;
  }

  /** Read the current rows/columns/error for a qid (post-await snapshot). */
  private readEntry(queryId: string | undefined): SqlQueryResult {
    const entry = queryId != null ? this.data[queryId] : undefined;
    if (!entry) {
      const error = queryId != null ? this.errors[queryId] ?? null : null;
      return { rows: [], columns: [], ...(error ? { error } : {}) };
    }
    const rows = entry.rows ?? [];
    const columns = entry.columns ?? [];
    // A live source that failed a refetch keeps its last-good rows and holds a
    // transient error INTERNALLY (errors[qid]) — but the pinned SDK hook
    // (useDuckDbSqlQuery, 0.4.0) discards rows whenever `error` is truthy. So
    // when we have non-empty rows we must NOT surface the error: keeping the
    // data on screen wins over a visible error badge. The error still surfaces
    // for the blank cases (empty/absent rows: non-interval failures and
    // interval-first-fetch failures). A visible stale/error indicator alongside
    // kept rows is deferred — it needs an SDK affordance (see journal).
    if (rows.length > 0) return { rows, columns };
    const error = queryId != null ? this.errors[queryId] : undefined;
    return { rows, columns, ...(error ? { error } : {}) };
  }

  /**
   * Ensure a qid's rows reflect its current param values, then return them.
   *
   * Fresh (or no resolveUrl / no params) → returns the cached entry immediately.
   * Stale → joins the in-flight fetch for the current ALL-params snapshot, or
   * starts one, awaits it, then returns the (possibly updated) entry. The await
   * is what keeps the SDK hook's `loading` true during a refetch.
   */
  async ensureFresh(queryId: string | undefined): Promise<SqlQueryResult> {
    if (queryId == null) return this.readEntry(queryId);

    // Cannot re-resolve without an endpoint: serve whatever we have.
    if (!this.resolveUrl) return this.readEntry(queryId);

    // A disposed store never re-resolves (its in-flight fetch was aborted on
    // dispose); serve the last-known rows.
    if (this.disposed) return this.readEntry(queryId);

    if (this.isStale(queryId)) {
      await this.refetchStale();
    }
    return this.readEntry(queryId);
  }

  /**
   * Coalesced single-flight re-resolve. Computes the set of stale qids, the
   * union of which is the `only:` list, and POSTs the FULL current snapshot of
   * ALL depMap params. One POST per param-change burst.
   *
   * Every pass re-reads the CURRENT live snapshot and bases both the
   * supersede decision AND the fetch body on it (never on a snapshot captured
   * at entry). This is what keeps a param change that lands DURING an await from
   * being clobbered:
   *   - in-flight covers the CURRENT params (same snapKey) → coalesce (await it)
   *     and loop again: a qid forced stale mid-flight may remain unresolved, or
   *     params may have changed during the await, so re-decide against live
   *     state rather than returning;
   *   - in-flight is for a DIFFERENT snapshot than the LIVE one → it is stale
   *     relative to current params → supersede (abort) and fetch fresh;
   *   - nothing stale → return (the drained/covering fetch already covered us,
   *     so no redundant POST).
   * A NEWER fetch for the current params is NEVER aborted (its snapKey equals
   * the live snapKey → coalesced, not superseded). Stale responses are also
   * discarded by the snapshot-identity guard in `runFetch`.
   */
  private async refetchStale(): Promise<void> {
    for (;;) {
      const fullSnapshot = this.params.getSnapshotMany(this.allParamNames);
      const snapKey = snapshotKey(fullSnapshot);

      if (this.inflight) {
        if (this.inflight.snapKey === snapKey) {
          // The in-flight fetch is for the CURRENT params — coalesce onto it.
          // Loop again afterwards: it may not have covered a qid forced stale
          // mid-flight, or params may have moved during the await.
          await this.inflight.promise;
          continue;
        }
        // The in-flight fetch is for a DIFFERENT snapshot than the live params
        // → it is stale → supersede it. (Never reached for a fetch matching the
        // live snapKey, so a newer fetch for the current params is safe.)
        this.inflight.controller.abort();
        this.inflight = null;
      }

      // Both the `only:` list and the body params derive from the SAME live
      // snapshot read this pass, so they can never disagree.
      const staleQids = this.computeStaleQids();
      if (staleQids.length === 0) return;

      const controller = new AbortController();
      const promise = this.runFetch(
        snapKey,
        fullSnapshot,
        staleQids,
        controller.signal,
      );
      this.inflight = { snapKey, controller, promise };
      await promise;
      return;
    }
  }

  private computeStaleQids(): string[] {
    const out: string[] = [];
    for (const qid of Object.keys(this.qidToParams)) {
      if (this.isStale(qid)) out.push(qid);
    }
    return out;
  }

  private async runFetch(
    snapKey: string,
    fullSnapshot: ParamSnapshot,
    staleQids: string[],
    signal: AbortSignal,
  ): Promise<void> {
    let response: ResolveResponse | null = null;
    try {
      const res = await fetch(this.resolveUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: this.config,
          params: fullSnapshot,
          only: staleQids,
        }),
        signal,
      });
      if (!res.ok) {
        // Endpoint-level failure: mark the stale qids errored, leave others.
        this.applyEndpointError(
          staleQids,
          fullSnapshot,
          `Resolver returned HTTP ${res.status}`,
          signal,
        );
        return;
      }
      response = (await res.json()) as ResolveResponse;
    } catch (e: unknown) {
      if (signal.aborted) return; // superseded — discard silently
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Re-resolve request failed";
      this.applyEndpointError(staleQids, fullSnapshot, msg, signal);
      return;
    } finally {
      // Clear the in-flight slot only if it's still THIS fetch (a newer one may
      // have already replaced it via supersede).
      if (this.inflight && this.inflight.snapKey === snapKey) {
        this.inflight = null;
      }
    }

    // Snapshot-identity guard: never apply a stale response. If superseded
    // (signal aborted) drop it; we compare against the snapshot we sent.
    if (signal.aborted) return;
    this.applyResponse(response, staleQids, fullSnapshot);
  }

  /**
   * Apply a successful re-resolve. Per-qid: update only the qids in `only`
   * (the response is scoped to them), set rows or error, and stamp each qid's
   * `paramSnapshotKey` to the snapshot we resolved with. Never clobber qids
   * outside `only`.
   */
  private applyResponse(
    response: ResolveResponse | null,
    staleQids: string[],
    fullSnapshot: ParamSnapshot,
  ): void {
    const data = response?.data ?? {};
    const errors = response?.errors ?? {};
    for (const qid of staleQids) {
      if (Object.prototype.hasOwnProperty.call(errors, qid)) {
        // A 200 with a per-qid error IS a failure for this qid — route it
        // through the shared failure path so a live source keeps its last-good
        // rows and backs off exactly like an endpoint failure. Do NOT fall
        // through to the success tail (no backoff reset, no normal-interval
        // reschedule).
        this.recordQidFailure(qid, fullSnapshot, errors[qid]);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(data, qid)) {
        this.data[qid] = data[qid];
        delete this.errors[qid];
      } else {
        // Resolver didn't return this qid (unknown id ignored server-side):
        // leave any existing rows untouched, but if we have none yet record an
        // empty entry so the fetch-on-mount check in isStale (which treats
        // `undefined` rows as unresolved) doesn't spin re-fetching a qid the
        // server won't resolve. The snapshot is still advanced below. This is
        // NOT a failure — don't touch backoff.
      }
      if (this.data[qid] === undefined)
        this.data[qid] = { columns: [], rows: [] };
      this.paramSnapshotKey[qid] = snapshotKey(
        this.restrictToQid(qid, fullSnapshot),
      );
      // A forced (timer-driven) fetch is now handled — clear it so isStale
      // stops returning true for this qid.
      this.forced.delete(qid);
      // Genuine success (data returned, or a benign not-returned qid) clears any
      // backoff so the next tick is at the normal interval again.
      this.failCounts.delete(qid);
      // Reset the refetch clock on EVERY successful resolve (timer- or
      // param/write-driven) so the next tick lands a full interval after the
      // most recent fetch — no matter what triggered it.
      if (qid in this.refreshIntervals) this.scheduleTimer(qid);
    }
  }

  /**
   * Endpoint-level failure (network/HTTP).
   *
   * Live (interval) qid that already holds good rows: keep the last-good rows,
   * surface the error as a transient indicator (rows are NOT blanked), and back
   * off — increment the fail count and reschedule at the exponential delay
   * (`scheduleTimer` consults `failCounts`). This is what lets a live dashboard
   * keep showing the last value through a resolver blip.
   *
   * Otherwise (a non-interval / param-driven qid, or an interval qid whose very
   * FIRST fetch failed so there are no rows to keep): today's behavior — blank
   * rows + error so the widget shows a clear error rather than an empty-but-
   * "fresh" chart.
   *
   * In all cases advance `paramSnapshotKey` so we don't tight-loop retrying the
   * same params outside the timer, and clear `forced` so the failed tick's force
   * flag doesn't keep the qid stale.
   */
  private applyEndpointError(
    staleQids: string[],
    fullSnapshot: ParamSnapshot,
    message: string,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) return;
    for (const qid of staleQids) {
      this.recordQidFailure(qid, fullSnapshot, message);
    }
  }

  /**
   * Record a single qid's refetch failure — the ONE place both failure channels
   * converge (endpoint/network/HTTP via `applyEndpointError`, and a 200 whose
   * per-qid `errors` map names this qid via `applyResponse`). Behaviourally
   * identical for a given qid regardless of channel:
   *
   *   - interval qid WITH prior non-empty rows → keep the rows (do NOT blank
   *     `data[qid]`), set `errors[qid]` as an internal indicator (`readEntry`
   *     drops it from the visible result while rows exist), increment
   *     `failCounts`, and reschedule at the backed-off delay;
   *   - interval qid with NO prior rows → blank + error, increment `failCounts`,
   *     back off (a live source whose FIRST fetch fails shows a clear error);
   *   - non-interval qid → blank + error, no `failCounts` (unchanged param-
   *     driven behaviour).
   *
   * Always advances `paramSnapshotKey` (so we don't tight-loop outside the
   * timer) and clears `forced`. Never resets `failCounts` — only a genuine
   * success (in `applyResponse`) does.
   */
  private recordQidFailure(
    qid: string,
    fullSnapshot: ParamSnapshot,
    message: string,
  ): void {
    const hasInterval = qid in this.refreshIntervals;
    const existing = this.data[qid];
    const hasRows = existing !== undefined && (existing.rows?.length ?? 0) > 0;
    if (hasInterval && hasRows) {
      // Keep last-good rows; surface a transient error; back off.
      this.errors[qid] = message;
      this.failCounts.set(qid, (this.failCounts.get(qid) ?? 0) + 1);
    } else {
      // No rows to preserve (or not a live source): blank + error.
      this.data[qid] = { columns: [], rows: [] };
      this.errors[qid] = message;
      if (hasInterval)
        this.failCounts.set(qid, (this.failCounts.get(qid) ?? 0) + 1);
    }
    this.paramSnapshotKey[qid] = snapshotKey(
      this.restrictToQid(qid, fullSnapshot),
    );
    this.forced.delete(qid);
    // Reschedule at the backed-off delay (scheduleTimer reads failCounts).
    if (hasInterval) this.scheduleTimer(qid);
  }

  /**
   * Start the interval-refetch timers and the page-visibility wiring.
   *
   * No-op without a `resolveUrl` (the read-only sandbox can't re-resolve) and
   * idempotent (a second call doesn't double-schedule). Does NOT fetch
   * immediately — it only schedules timers; the sole immediate refetch happens
   * on a visibility hidden→visible transition. (The store is disposed+restarted
   * on every host rebuild, so a fetch-on-start would turn unrelated rebuilds
   * into a refetch storm.)
   */
  start(): void {
    if (!this.resolveUrl || this.started || this.disposed) return;
    this.started = true;
    for (const qid of Object.keys(this.refreshIntervals)) this.scheduleTimer(qid);
    if (
      typeof document !== "undefined" &&
      typeof document.addEventListener === "function"
    ) {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  /** Clear all timers and remove the visibility listener; guards reschedules. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    // Abort any in-flight resolve so a disposed store doesn't finish a wasted
    // round-trip. The aborted response is dropped by runFetch's signal.aborted
    // guard; no-op when nothing is in flight.
    if (this.inflight) {
      this.inflight.controller.abort();
      this.inflight = null;
    }
    if (
      typeof document !== "undefined" &&
      typeof document.removeEventListener === "function"
    ) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  /** Clear every pending timer (keeps `refreshIntervals` so resume can reschedule). */
  private clearTimers(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }

  /**
   * (Re)schedule a single qid's timer: clear any pending one and set a fresh
   * single-shot `setTimeout` for its interval. A tick force-marks the qid,
   * runs the shared coalesced refetch, and reschedules — unless disposed or
   * hidden. Never schedules for a qid without a configured interval.
   */
  private scheduleTimer(qid: string): void {
    if (this.disposed || this.hidden) return;
    const interval = this.refreshIntervals[qid];
    if (interval === undefined) return;
    const existing = this.timers.get(qid);
    if (existing !== undefined) clearTimeout(existing);
    const handle = setTimeout(() => {
      void this.tick(qid);
    }, this.nextDelay(qid, interval));
    this.timers.set(qid, handle);
  }

  /**
   * The single source of truth for a qid's next-tick delay: the normal interval
   * when it's healthy (`failCounts` 0), otherwise the exponential backoff
   * `min(interval * 2 ** failures, MAX_BACKOFF_MS)`. Every reschedule path (tick
   * and applyEndpointError) goes through `scheduleTimer` → here, so the backoff
   * always wins over the normal interval while failures persist, and the normal
   * cadence resumes the instant a success resets the counter.
   */
  private nextDelay(qid: string, interval: number): number {
    const failures = this.failCounts.get(qid) ?? 0;
    if (failures === 0) return interval;
    return Math.min(interval * 2 ** failures, MAX_BACKOFF_MS);
  }

  /**
   * One timer tick: force the qid stale, run the shared single-flight refetch
   * (its `only:` scoping + coalescing + supersede-abort all apply), then
   * reschedule. `applyResponse` already reschedules on success; this reschedule
   * covers the paths where no successful apply ran (e.g. coalesced-away or
   * errored) so the cadence never stalls. Guarded on `!disposed && !hidden`.
   */
  private async tick(qid: string): Promise<void> {
    if (this.disposed || this.hidden) return;
    this.forced.add(qid);
    await this.refetchStale();
    if (!this.disposed && !this.hidden) this.scheduleTimer(qid);
  }
}
