import { afterEach, describe, expect, it, vi } from "vitest";

import { WidgetDataStore, collectRefreshIntervals } from "../../data-store";
import { createParamsStore, createStaticBridge } from "../../static-bridge";
import {
  createCanvasRuntime,
  type CanvasDataInputs,
} from "../canvas-data";
import { createCanvasParamStore } from "../canvas-param-store";
import type { CanvasNode } from "../canvas-types";

/** Minimal stand-in for the Fetch `Response` the store reads (`ok` + `json()`). */
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Parse the JSON body of the Nth fetch call (the resolve POST). */
function fetchBody(
  mock: ReturnType<typeof vi.fn>,
  n = 0,
): Record<string, unknown> {
  const init = mock.mock.calls[n][1] as RequestInit;
  return JSON.parse(init.body as string);
}

/**
 * Stubbed `document` visibility surface: tracks listeners so a test can flip
 * `visibilityState` and dispatch a `visibilitychange` event synchronously.
 */
function stubVisibility(initial: "visible" | "hidden" = "visible") {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: (type: string, fn: () => void) => {
      if (type === "visibilitychange") listeners.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === "visibilitychange") listeners.delete(fn);
    },
  };
  const set = (state: "visible" | "hidden") => {
    doc.visibilityState = state;
    for (const fn of [...listeners]) fn();
  };
  const listenerCount = () => listeners.size;
  vi.stubGlobal("document", doc);
  return { set, listenerCount };
}

describe("collectRefreshIntervals", () => {
  it("harvests a node's refreshInterval keyed by its _queryId", () => {
    const config = {
      type: "metric",
      props: { _queryId: "q0", refreshInterval: 5000 },
    };
    expect(collectRefreshIntervals(config)).toEqual({ q0: 5000 });
  });

  it("collects per-layer intervals on a map / fused-map node", () => {
    const config = {
      type: "map",
      props: {
        layers: [
          { _queryId: "la", refreshInterval: 3000 },
          { _queryId: "lb", refreshInterval: 8000 },
        ],
      },
    };
    expect(collectRefreshIntervals(config)).toEqual({ la: 3000, lb: 8000 });

    const fusedMap = {
      type: "fused-map",
      props: { layers: [{ _queryId: "lc", refreshInterval: 2500 }] },
    };
    expect(collectRefreshIntervals(fusedMap)).toEqual({ lc: 2500 });
  });

  it("recurses canvas props.nodes[].widget subtrees", () => {
    const config = {
      type: "canvas",
      props: {
        nodes: [
          {
            widget: {
              type: "metric",
              props: { _queryId: "q0", refreshInterval: 5000 },
            },
          },
          {
            widget: {
              type: "chart",
              props: { _queryId: "q1", refreshInterval: 9000 },
            },
          },
        ],
      },
    };
    expect(collectRefreshIntervals(config)).toEqual({ q0: 5000, q1: 9000 });
  });

  it("omits a _queryId that has no refreshInterval", () => {
    const config = {
      type: "metric",
      props: { _queryId: "q0" },
    };
    expect(collectRefreshIntervals(config)).toEqual({});
  });

  it("clamps a below-floor interval up to MIN_REFRESH_INTERVAL_MS (1000)", () => {
    const config = {
      type: "metric",
      props: { _queryId: "q0", refreshInterval: 250 },
    };
    expect(collectRefreshIntervals(config)).toEqual({ q0: 1000 });
  });

  it("rejects non-positive, NaN, and non-number values (no entry)", () => {
    const cases: unknown[] = [0, -5000, Number.NaN, "5000", null, undefined];
    for (const refreshInterval of cases) {
      const config = {
        type: "metric",
        props: { _queryId: "q0", refreshInterval },
      };
      expect(collectRefreshIntervals(config)).toEqual({});
    }
  });
});

describe("WidgetDataStore — refreshIntervalFor", () => {
  const canvasConfig = {
    type: "canvas",
    props: {
      nodes: [
        {
          widget: {
            type: "metric",
            props: { _queryId: "q0", refreshInterval: 5000 },
          },
        },
        {
          widget: {
            type: "chart",
            props: { _queryId: "q1", refreshInterval: 9000 },
          },
        },
      ],
    },
  };

  it("exposes the harvested interval for a tracked qid", () => {
    const store = new WidgetDataStore({
      config: canvasConfig,
      params: createParamsStore(),
    });
    expect(store.refreshIntervalFor("q0")).toBe(5000);
    expect(store.refreshIntervalFor("q1")).toBe(9000);
  });

  it("restricts intervals to the qids this store owns (queryIds)", () => {
    const store = new WidgetDataStore({
      config: canvasConfig,
      queryIds: ["q0"],
      params: createParamsStore(),
    });
    expect(store.refreshIntervalFor("q0")).toBe(5000);
    // q1 belongs to another node — this store must not own its interval.
    expect(store.refreshIntervalFor("q1")).toBeUndefined();
  });
});

describe("WidgetDataStore — interval-refetch timer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires one scoped refetch per interval tick and swaps rows", async () => {
    vi.useFakeTimers();
    stubVisibility();
    let value = 1;
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { q0: { columns: ["v"], rows: [{ v: value++ }] } },
        errors: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    // start() does NOT fetch immediately.
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchBody(fetchMock, 0).only).toEqual(["q0"]);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 1 }]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    store.dispose();
  });

  it("notifies output subscribers after each tick (the re-render channel)", async () => {
    // A timer refetch updates `this.data` in place; the SDK `useDuckDbSqlQuery`
    // hook does not observe the store directly, so it re-reads only when the
    // `subscribeOutput` channel fires. Without this notify the store fetched
    // fresh rows but the node never repainted (the interval-refetch bug).
    vi.useFakeTimers();
    stubVisibility();
    let value = 1;
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { q0: { columns: ["v"], rows: [{ v: value++ }] } },
        errors: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    const onOutput = vi.fn();
    const unsub = store.subscribeOutput(onOutput);
    store.start();

    // start() neither fetches nor notifies immediately.
    expect(onOutput).not.toHaveBeenCalled();

    // A tick refetches AND notifies (after the refetch) so the hook re-reads.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 1 }]);

    // Unsubscribe → the next tick still fetches but no longer notifies.
    unsub();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onOutput).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it("ticks two qids independently at their own cadences", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: {}, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { fast: { columns: [], rows: [] }, slow: { columns: [], rows: [] } },
      resolveUrl: "/data",
      config: {
        type: "canvas",
        props: {
          nodes: [
            { widget: { type: "metric", props: { _queryId: "fast", refreshInterval: 2000 } } },
            { widget: { type: "metric", props: { _queryId: "slow", refreshInterval: 5000 } } },
          ],
        },
      },
      params: createParamsStore(),
    });
    store.start();

    await vi.advanceTimersByTimeAsync(2000); // t=2000: fast ticks
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchBody(fetchMock, 0).only).toEqual(["fast"]);

    await vi.advanceTimersByTimeAsync(2000); // t=4000: fast again
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchBody(fetchMock, 1).only).toEqual(["fast"]);

    await vi.advanceTimersByTimeAsync(1000); // t=5000: slow ticks
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchBody(fetchMock, 2).only).toEqual(["slow"]);

    store.dispose();
  });

  it("resets the clock when a param-driven refetch lands", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const params = createParamsStore();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { q0: { columns: [], rows: [] } }, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: [], rows: [{ v: 0 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      harvestedParams: { region: "us" },
      params,
    });
    store.start();

    // t=3000: change a param → ensureFresh refetches (resets clock).
    await vi.advanceTimersByTimeAsync(3000);
    params.set("region", "eu");
    await store.ensureFresh("q0");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Original schedule would tick at t=5000 (2000ms from now). It must NOT.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A full interval after the param fetch (t=8000) → the timer fires.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    store.dispose();
  });

  it("pauses when hidden and refetches once + resumes when visible", async () => {
    vi.useFakeTimers();
    const vis = stubVisibility("visible");
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { q0: { columns: [], rows: [] } }, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: [], rows: [] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    vis.set("hidden");
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).not.toHaveBeenCalled();

    vis.set("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one immediate refetch

    await vi.advanceTimersByTimeAsync(5000); // schedule resumed
    expect(fetchMock).toHaveBeenCalledTimes(2);

    store.dispose();
  });

  it("dispose aborts an in-flight resolve and its (late) response is a no-op", async () => {
    vi.useFakeTimers();
    stubVisibility();
    let capturedSignal: AbortSignal | undefined;
    let resolveFetch: ((r: unknown) => void) | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise((res) => {
        resolveFetch = res;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    // Tick begins a fetch that never resolves on its own.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    // Dispose mid-flight → the in-flight request's signal is aborted.
    store.dispose();
    expect(capturedSignal?.aborted).toBe(true);

    // The late (aborted) response must NOT mutate data or reschedule anything.
    resolveFetch?.(
      jsonResponse({ data: { q0: { columns: ["v"], rows: [{ v: 99 }] } }, errors: {} }),
    );
    await vi.advanceTimersByTimeAsync(20000);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 0 }]); // unchanged
    expect(fetchMock).toHaveBeenCalledTimes(1); // no reschedule
  });

  it("dispose clears timers and removes the visibility listener", async () => {
    vi.useFakeTimers();
    const vis = stubVisibility();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { q0: { columns: [], rows: [] } }, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: [], rows: [] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();
    expect(vis.listenerCount()).toBe(1);

    store.dispose();
    expect(vis.listenerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("start() is a no-op when resolveUrl is unset (read-only sandbox)", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const fetchMock = vi.fn(async () => jsonResponse({ data: {}, errors: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: [], rows: [] } },
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).not.toHaveBeenCalled();

    store.dispose();
  });
});

describe("WidgetDataStore — refresh failure handling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps last-good rows + backs off exponentially on a failed tick, then recovers", async () => {
    vi.useFakeTimers();
    stubVisibility();
    let mode: "ok" | "fail" = "ok";
    const fetchMock = vi.fn(async () => {
      if (mode === "fail") throw new Error("network down");
      return jsonResponse({
        data: { q0: { columns: ["v"], rows: [{ v: 1 }] } },
        errors: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    // First tick succeeds (rows -> v:1).
    await vi.advanceTimersByTimeAsync(5000);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 1 }]);

    // Next tick fails: last-good rows kept and stay VISIBLE — no `error` field
    // leaks to the SDK hook (which would blank the rows). The failure is
    // observable only via the backed-off retry timing below.
    mode = "fail";
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const afterFail = await store.ensureFresh("q0");
    expect(afterFail.rows).toEqual([{ v: 1 }]); // last-good, not []
    expect(afterFail.error).toBeUndefined(); // rows stay visible

    // Backoff: interval (5000) does NOT retry; interval*2 (10000) does.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000); // now at t=+10000 since fail
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Still failing → next backoff is interval*4 (20000).
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Recovery: a success clears the error, resets backoff to normal cadence.
    mode = "ok";
    await vi.advanceTimersByTimeAsync(40000); // that attempt was at *8 backoff
    const recovered = await store.ensureFresh("q0");
    expect(recovered.rows).toEqual([{ v: 1 }]);
    expect(recovered.error).toBeUndefined();
    const callsAtRecovery = fetchMock.mock.calls.length;

    // Normal 5000 cadence restored (no more backoff).
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtRecovery + 1);

    store.dispose();
  });

  it("a failed param-driven refetch does NOT reset an active backoff (only success does)", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const params = createParamsStore();
    let mode: "ok" | "fail" = "ok";
    const fetchMock = vi.fn(async () => {
      if (mode === "fail") throw new Error("down");
      return jsonResponse({
        data: { q0: { columns: ["v"], rows: [{ v: 1 }] } },
        errors: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      harvestedParams: { region: "us" },
      params,
    });
    store.start();

    // First tick fails → failCounts=1 → next retry backed off to *2 (10000).
    mode = "fail";
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A param change drives an ensureFresh that ALSO fails — must not reset the
    // counter. It bumps failCounts to 2 (backoff continues growing, not restart).
    params.set("region", "eu");
    await store.ensureFresh("q0");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // If the param failure had reset the counter, the timer would retry at *2
    // (10000). Because it grew to failCounts=2, the next retry is at *4 (20000):
    // advancing 10000 must NOT retry.
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The kept rows are still visible (last-good, no error field).
    const kept = await store.ensureFresh("q0");
    expect(kept.rows).toEqual([{ v: 0 }]);
    expect(kept.error).toBeUndefined();
    // At *4 (20000 total from the param fetch) the timer fires.
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    store.dispose();
  });

  it("a 200-with-per-qid-error keeps last-good rows + backs off like a network failure", async () => {
    vi.useFakeTimers();
    stubVisibility();
    let mode: "ok" | "qiderr" = "ok";
    const fetchMock = vi.fn(async () =>
      mode === "qiderr"
        ? jsonResponse({ data: {}, errors: { q0: "boom" } })
        : jsonResponse({
            data: { q0: { columns: ["v"], rows: [{ v: 1 }] } },
            errors: {},
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    // Success first (v -> 1).
    await vi.advanceTimersByTimeAsync(5000);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 1 }]);

    // Tick returns HTTP 200 with a per-qid error → last-good rows kept, no
    // visible error, backoff engaged (not the normal interval, failCounts kept).
    mode = "qiderr";
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const afterErr = await store.ensureFresh("q0");
    expect(afterErr.rows).toEqual([{ v: 1 }]); // last-good, not blanked
    expect(afterErr.error).toBeUndefined();

    // Backoff *2 (10000), then *4 (20000) — identical to the network case.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // normal interval does NOT retry
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // *2 fires
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // still within *4
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // *4 fires

    // A genuine success clears the error and resets cadence + backoff.
    mode = "ok";
    await vi.advanceTimersByTimeAsync(40000); // that attempt was at *8 backoff
    const recovered = await store.ensureFresh("q0");
    expect(recovered.rows).toEqual([{ v: 1 }]);
    expect(recovered.error).toBeUndefined();
    const callsAtRecovery = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); // normal cadence restored
    expect(fetchMock).toHaveBeenCalledTimes(callsAtRecovery + 1);

    store.dispose();
  });

  it("a NON-interval qid with a 200-per-qid-error still blanks + errors", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: {}, errors: { q0: "sql failed" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const params = createParamsStore();
    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 7 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { sql: "SELECT $region", _queryId: "q0" } },
      harvestedParams: { region: "us" },
      params,
    });

    params.set("region", "eu");
    const entry = await store.ensureFresh("q0");
    // No interval → per-qid error blanks rows + surfaces the error (no regression).
    expect(entry.rows).toEqual([]);
    expect(entry.error).toBe("sql failed");
  });

  it("blanks + errors an interval qid whose FIRST fetch fails (no last-good)", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: {}, // no rows yet
      resolveUrl: "/data",
      config: { type: "metric", props: { _queryId: "q0", refreshInterval: 5000 } },
      params: createParamsStore(),
    });
    store.start();

    await vi.advanceTimersByTimeAsync(5000);
    const entry = await store.ensureFresh("q0");
    expect(entry.rows).toEqual([]); // blanked
    expect(entry.error).toBe("boom");

    store.dispose();
  });

  it("blanks + errors a NON-interval (param-driven) qid on a failed refetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("param fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const params = createParamsStore();
    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 7 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { sql: "SELECT $region", _queryId: "q0" } },
      harvestedParams: { region: "us" },
      params,
    });

    params.set("region", "eu");
    const entry = await store.ensureFresh("q0");
    // No interval → today's behavior: rows blanked, error set.
    expect(entry.rows).toEqual([]);
    expect(entry.error).toBe("param fetch failed");
  });
});

describe("createCanvasRuntime — lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A minimal base FusedWidgetBridge for the runtime to delegate to. */
  function makeBaseBridge() {
    const params = createParamsStore();
    // The inner store is never exercised (the canvas builds per-node stores that
    // shadow sql.query); it just satisfies createStaticBridge's shape.
    const inner = new WidgetDataStore({ params });
    return createStaticBridge({ store: inner, params });
  }

  it("dispose clears per-node timers but leaves the shared param store intact", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { q0: { columns: [], rows: [] } }, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const nodes: CanvasNode[] = [
      {
        id: "n1",
        widget: {
          type: "metric",
          props: { _queryId: "q0", refreshInterval: 5000 },
        },
      },
    ];
    const store = createCanvasParamStore();
    const inputs: CanvasDataInputs = {
      config: {
        type: "canvas",
        props: {
          nodes: [{ widget: nodes[0].widget }],
        },
      },
      data: { q0: { columns: [], rows: [] } },
      resolveUrl: "/data",
      baseBridge: makeBaseBridge(),
    };
    const runtime = createCanvasRuntime(
      nodes,
      [],
      inputs,
      { onStartLoading: () => {}, onStopLoading: () => {} },
      undefined,
      store,
    );

    // A user selection lives in the shared canvas param store.
    store.set("region", "eu", "n1", 1);

    runtime.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // timer fired once

    runtime.dispose();
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no further ticks after dispose

    // The shared param store must SURVIVE dispose (reused across rebuilds).
    expect(store.getSnapshotFiltered("region", ["n1"])).toBe("eu");
  });
});

describe("WidgetDataStore — coalesce race", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * A fetch stub that never resolves on its own: each call is parked, and the
   * test resolves calls by index. Captures the POST body's `only` per call.
   */
  function deferredFetch() {
    const calls: {
      only: string[];
      params: Record<string, unknown>;
      signal: AbortSignal | undefined;
      resolve: (body: unknown) => void;
    }[] = [];
    const fn = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return new Promise((res) => {
        calls.push({
          only: body.only as string[],
          params: body.params as Record<string, unknown>,
          signal: init.signal ?? undefined,
          resolve: (b: unknown) => res(jsonResponse(b)),
        });
      });
    });
    return { fn, calls };
  }

  it("re-resolves a forced qid that coalesced onto a non-covering in-flight fetch", async () => {
    vi.useFakeTimers();
    stubVisibility();
    const { fn, calls } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    // Two param-free interval qids → the same (empty) snapshot key, so a second
    // refetch coalesces onto the first's in-flight promise. Different intervals
    // so A's timer fires (and parks its fetch) before B's tick lands.
    const store = new WidgetDataStore({
      data: {
        a: { columns: ["v"], rows: [{ v: 0 }] },
        b: { columns: ["v"], rows: [{ v: 0 }] },
      },
      resolveUrl: "/data",
      config: {
        type: "canvas",
        props: {
          nodes: [
            { widget: { type: "metric", props: { _queryId: "a", refreshInterval: 3000 } } },
            { widget: { type: "metric", props: { _queryId: "b", refreshInterval: 5000 } } },
          ],
        },
      },
      params: createParamsStore(),
    });
    store.start();

    // A's timer fires → forces A stale, starts a resolve parked in flight
    // (covers only [a]).
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(1);
    expect(calls[0].only).toEqual(["a"]);

    // While A is in flight, B's timer fires (t=5000): forces B stale and calls
    // refetchStale, which sees the same empty snapshot and coalesces onto A's
    // promise. B is NOT in A's `only`.
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1); // coalesced — no new fetch yet

    // Resolve A's fetch → the coalesced B path falls through, sees B still stale,
    // and starts a second fetch scoped to [b] in the SAME cycle.
    calls[0].resolve({ data: { a: { columns: ["v"], rows: [{ v: 1 }] } }, errors: {} });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(2);
    expect(calls[1].only).toEqual(["b"]);

    calls[1].resolve({ data: { b: { columns: ["v"], rows: [{ v: 2 }] } }, errors: {} });
    await vi.advanceTimersByTimeAsync(0);

    expect((await store.ensureFresh("a")).rows).toEqual([{ v: 1 }]);
    expect((await store.ensureFresh("b")).rows).toEqual([{ v: 2 }]);

    store.dispose();
  });

  it("two concurrent reads of the same already-covered qid coalesce into one fetch", async () => {
    const { fn, calls } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    const params = createParamsStore();
    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { sql: "SELECT $region", _queryId: "q0" } },
      harvestedParams: { region: "us" },
      params,
    });

    // One param change makes q0 stale; two readers race for it.
    params.set("region", "eu");
    const p1 = store.ensureFresh("q0");
    const p2 = store.ensureFresh("q0");
    expect(calls).toHaveLength(1); // single-flight: the second coalesced

    calls[0].resolve({ data: { q0: { columns: ["v"], rows: [{ v: 9 }] } }, errors: {} });
    await Promise.all([p1, p2]);

    expect(calls).toHaveLength(1); // still exactly one POST — no redundant fetch
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 9 }]);
  });

  it("does NOT abort a newer fetch started for changed params during a drain", async () => {
    const { fn, calls } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    const params = createParamsStore();
    const store = new WidgetDataStore({
      data: { q0: { columns: ["v"], rows: [{ v: 0 }] } },
      depMap: { region: ["q0"] },
      resolveUrl: "/data",
      config: { type: "metric", props: { sql: "SELECT $region", _queryId: "q0" } },
      harvestedParams: { region: "us" },
      params,
    });

    // Reader 1 sets params S1 (region=eu) and starts a fetch (parked in flight).
    params.set("region", "eu");
    const p1 = store.ensureFresh("q0");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ region: "eu" });

    // Reader 2 coalesces onto S1 (same live params) and parks in the drain loop.
    const p2 = store.ensureFresh("q0");
    expect(calls).toHaveLength(1); // coalesced, no new fetch

    // Params change to S2 (region=fr) and a NEWER refetch for S2 starts while
    // S1 is still in flight — S1 (≠ live S2) is superseded/aborted; S2 starts.
    params.set("region", "fr");
    const p3 = store.ensureFresh("q0");
    expect(calls).toHaveLength(2);
    expect(calls[1].params).toEqual({ region: "fr" });
    expect(calls[0].signal?.aborted).toBe(true); // S1 superseded
    expect(calls[1].signal?.aborted).toBe(false); // S2 is the current fetch

    // Resolve S1 (aborted → ignored). Reader 2's drain loops, re-reads LIVE
    // params (S2), sees the in-flight S2 matches → coalesces, does NOT abort it.
    calls[0].resolve({ data: { q0: { columns: ["v"], rows: [{ v: 1 }] } }, errors: {} });
    await p1;
    await Promise.resolve();
    expect(calls[1].signal?.aborted).toBe(false); // S2 STILL not aborted
    expect(calls).toHaveLength(2); // no spurious extra fetch

    // S2 completes normally and its rows win.
    calls[1].resolve({ data: { q0: { columns: ["v"], rows: [{ v: 2 }] } }, errors: {} });
    await Promise.all([p2, p3]);
    expect(calls[1].signal?.aborted).toBe(false);
    expect((await store.ensureFresh("q0")).rows).toEqual([{ v: 2 }]);
  });
});
