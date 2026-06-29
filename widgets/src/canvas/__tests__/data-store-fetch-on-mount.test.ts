import { afterEach, describe, expect, it, vi } from "vitest";

import { WidgetDataStore, collectConfigQueryIds } from "../../data-store";
import { createParamsStore } from "../../static-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Minimal stand-in for the Fetch `Response` the store reads (`ok` + `json()`). */
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Parse the JSON body of the Nth fetch call (the resolve POST). */
function fetchBody(mock: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  const init = mock.mock.calls[n][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("WidgetDataStore — fetch-on-mount", () => {
  it("resolves a param-free query on mount with no depMap (single POST)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: { q0: { columns: ["value"], rows: [{ value: 42 }] } },
        errors: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: {},
      errors: {},
      depMap: {},
      resolveUrl: "/data",
      config: {
        type: "metric",
        props: { sql: "SELECT 1 AS value", _queryId: "q0" },
      },
      harvestedParams: {},
      params: createParamsStore(),
    });

    const entry = await store.ensureFresh("q0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(entry.rows).toEqual([{ value: 42 }]);

    // The POST scopes `only` to the unresolved query, with empty params.
    const body = fetchBody(fetchMock);
    expect(body.only).toEqual(["q0"]);
    expect(body.params).toEqual({});

    // Second read: already resolved → no extra fetch.
    const again = await store.ensureFresh("q0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.rows).toEqual([{ value: 42 }]);
  });

  it("does not fetch when rows were pre-seeded (widget open / parley)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: {}, errors: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: { q0: { columns: ["value"], rows: [{ value: 7 }] } },
      errors: {},
      depMap: {},
      resolveUrl: "/data",
      config: {
        type: "metric",
        props: { sql: "SELECT 7 AS value", _queryId: "q0" },
      },
      params: createParamsStore(),
    });

    const entry = await store.ensureFresh("q0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entry.rows).toEqual([{ value: 7 }]);
  });

  it("serves empty without fetching when there is no resolveUrl", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: {},
      errors: {},
      depMap: {},
      config: { type: "metric", props: { sql: "SELECT 1", _queryId: "q0" } },
      params: createParamsStore(),
    });

    const entry = await store.ensureFresh("q0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entry.rows).toEqual([]);
  });

  it("reads a pre-seeded per-query error and does not re-fetch it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: {}, errors: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new WidgetDataStore({
      data: {},
      errors: { q0: "boom" },
      depMap: {},
      resolveUrl: "/data",
      config: { type: "metric", props: { sql: "SELECT 1", _queryId: "q0" } },
      params: createParamsStore(),
    });

    const entry = await store.ensureFresh("q0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entry.error).toBe("boom");
  });

  it("with explicit queryIds, resolves ONLY the owned query (canvas isolation)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { q0: { columns: ["v"], rows: [{ v: 1 }] } }, errors: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The config carries q0 AND q1, but this store owns only q0.
    const store = new WidgetDataStore({
      data: {},
      errors: {},
      depMap: {},
      resolveUrl: "/data",
      config: {
        type: "container",
        children: [
          { type: "metric", props: { sql: "SELECT 1 AS v", _queryId: "q0" } },
          { type: "metric", props: { sql: "SELECT 2 AS v", _queryId: "q1" } },
        ],
      },
      queryIds: ["q0"],
      params: createParamsStore(),
    });

    await store.ensureFresh("q0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // q1 belongs to another node — it is never tracked here, so never resolved.
    expect(fetchBody(fetchMock).only).toEqual(["q0"]);
  });
});

describe("collectConfigQueryIds", () => {
  it("collects props._queryId across nested children", () => {
    const config = {
      type: "container",
      children: [
        { type: "metric", props: { _queryId: "q0" } },
        { type: "group", children: [{ type: "bar-chart", props: { _queryId: "q1" } }] },
      ],
    };
    expect(collectConfigQueryIds(config).sort()).toEqual(["q0", "q1"]);
  });

  it("collects map / fused-map layer query ids", () => {
    const config = {
      type: "map",
      props: {
        layers: [{ _queryId: "q0" }, { _queryId: "q1" }, { tileUrl: "x" }],
      },
    };
    expect(collectConfigQueryIds(config).sort()).toEqual(["q0", "q1"]);
  });

  it("recurses canvas node widget subtrees", () => {
    const config = {
      type: "canvas",
      props: {
        nodes: [
          { widget: { type: "metric", props: { _queryId: "q0" } } },
          { widget: { type: "map", props: { layers: [{ _queryId: "q1" }] } } },
        ],
      },
    };
    expect(collectConfigQueryIds(config).sort()).toEqual(["q0", "q1"]);
  });

  it("is tolerant of malformed input", () => {
    expect(collectConfigQueryIds(null)).toEqual([]);
    expect(
      collectConfigQueryIds({ type: "x", props: 5, children: "nope" }),
    ).toEqual([]);
  });
});
