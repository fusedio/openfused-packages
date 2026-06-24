import { describe, it, expect, vi } from "vitest";

import { createCanvasParamStore } from "../canvas-param-store";

describe("createCanvasParamStore", () => {
  it("filters a snapshot to allowed origins and picks the most recent", () => {
    const store = createCanvasParamStore();
    store.set("region", "EU", "a", 1);
    store.set("region", "APAC", "b", 2);

    // Only "a" is an allowed origin that set the param → "EU".
    expect(store.getSnapshotFiltered("region", ["c", "a"])).toBe("EU");
    // Both "a" and "b" allowed → most recent (b, updatedAt 2) wins.
    expect(store.getSnapshotFiltered("region", ["c", "a", "b"])).toBe("APAC");
    // No allowed origin set the param → undefined.
    expect(store.getSnapshotFiltered("region", ["c"])).toBeUndefined();
  });

  it("resolves recency by updatedAt, not write order", () => {
    const store = createCanvasParamStore();
    store.set("region", "EU", "a", 1);
    store.set("region", "APAC", "b", 2);
    // "a" updates later (updatedAt 3) → now "a" wins over "b".
    store.set("region", "NA", "a", 3);

    expect(store.getSnapshotFiltered("region", ["c", "a", "b"])).toBe("NA");
  });

  it("records the full origin entry shape keyed by originId", () => {
    const store = createCanvasParamStore();
    store.set("region", "EU", "a", 7);

    expect(store.state.region.a).toEqual({
      value: "EU",
      originId: "a",
      originName: "a",
      updatedAt: 7,
    });
  });

  it("notifies a param's subscribers on set", () => {
    const store = createCanvasParamStore();
    const cb = vi.fn();
    store.subscribe("region", cb);

    store.set("region", "EU", "a", 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("clears one origin entry and notifies subscribers", () => {
    const store = createCanvasParamStore();
    const cb = vi.fn();
    store.subscribe("region", cb);
    store.set("region", "EU", "a", 1);
    store.set("region", "APAC", "b", 2);

    store.clear("region", "b");

    expect(store.getSnapshotFiltered("region", ["a", "b"])).toBe("EU");
    expect(store.state.region.b).toBeUndefined();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does not notify subscribers of a different param", () => {
    const store = createCanvasParamStore();
    const cb = vi.fn();
    store.subscribe("region", cb);

    store.set("other", "x", "a", 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createCanvasParamStore();
    const cb = vi.fn();
    const unsubscribe = store.subscribe("region", cb);

    store.set("region", "EU", "a", 1);
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set("region", "APAC", "a", 2);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
