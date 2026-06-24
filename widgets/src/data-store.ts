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
    this.qidToParams = qidToParams;
    this.allParamNames = [...allNames].sort();

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
    // No params => never re-resolves (static or context-free binding).
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
    return { rows: entry.rows ?? [], columns: entry.columns ?? [] };
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

    if (this.isStale(queryId)) {
      await this.refetchStale();
    }
    return this.readEntry(queryId);
  }

  /**
   * Coalesced single-flight re-resolve. Computes the set of stale qids, the
   * union of which is the `only:` list, and POSTs the FULL current snapshot of
   * ALL depMap params. One POST per param-change burst:
   *   - if a fetch for the EXACT current ALL-params snapshot is already in
   *     flight, await it (coalesce);
   *   - otherwise abort any older in-flight fetch (it was for a stale snapshot)
   *     and start a new one.
   * Stale responses are discarded by comparing the snapshot key at resolve time
   * against the latest snapshot (AbortController + identity guard).
   */
  private async refetchStale(): Promise<void> {
    const fullSnapshot = this.params.getSnapshotMany(this.allParamNames);
    const snapKey = snapshotKey(fullSnapshot);

    // Coalesce: an in-flight fetch for the identical snapshot already covers us.
    if (this.inflight && this.inflight.snapKey === snapKey) {
      await this.inflight.promise;
      return;
    }

    // Supersede: a newer snapshot aborts the older in-flight fetch. Its response
    // (if it still arrives) is ignored by the snapshot-identity guard below.
    if (this.inflight) {
      this.inflight.controller.abort();
      this.inflight = null;
    }

    // Recompute the stale set against the snapshot we're about to send so the
    // `only:` list matches the body's params exactly.
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
        // Per-qid error: rows:[] + error, never blanks the whole widget.
        this.data[qid] = { columns: [], rows: [] };
        this.errors[qid] = errors[qid];
      } else if (Object.prototype.hasOwnProperty.call(data, qid)) {
        this.data[qid] = data[qid];
        delete this.errors[qid];
      } else {
        // Resolver didn't return this qid (unknown id ignored server-side):
        // leave existing rows untouched but still advance its snapshot so we
        // don't spin re-fetching a qid the server won't resolve.
      }
      this.paramSnapshotKey[qid] = snapshotKey(
        this.restrictToQid(qid, fullSnapshot),
      );
    }
  }

  /**
   * Endpoint-level failure (network/HTTP). Surface the error per stale qid
   * (rows:[] + error) so the bound charts show an error rather than hanging,
   * and advance their snapshot so we don't tight-loop retrying the same params.
   */
  private applyEndpointError(
    staleQids: string[],
    fullSnapshot: ParamSnapshot,
    message: string,
    signal: AbortSignal,
  ): void {
    if (signal.aborted) return;
    for (const qid of staleQids) {
      this.data[qid] = { columns: [], rows: [] };
      this.errors[qid] = message;
      this.paramSnapshotKey[qid] = snapshotKey(
        this.restrictToQid(qid, fullSnapshot),
      );
    }
  }
}
