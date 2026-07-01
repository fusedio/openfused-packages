import { afterEach, describe, expect, it, vi } from "vitest";

import { WidgetDataStore, collectRefreshIntervals } from "../../data-store";
import { createParamsStore } from "../../static-bridge";

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

    // Next tick fails: last-good rows kept, error surfaced, no blanking.
    mode = "fail";
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const afterFail = await store.ensureFresh("q0");
    expect(afterFail.rows).toEqual([{ v: 1 }]); // last-good, not []
    expect(afterFail.error).toBe("network down");

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
