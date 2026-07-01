import { describe, expect, it } from "vitest";

import { WidgetDataStore, collectRefreshIntervals } from "../../data-store";
import { createParamsStore } from "../../static-bridge";

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
