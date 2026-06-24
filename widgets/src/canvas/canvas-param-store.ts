// Canvas-scoped, source-tagged param store backing edge-gated routing
// (canvas-model contract §3).
//
// A flat, unfiltered `Map<name, value>` is replaced with a `CanvasParamState`:
// every `set` is tagged with the originating node's id + an `updatedAt` stamp,
// and a read filters to a reader node's allowed sources then picks
// most-recent-wins.
//
// subscribe/notify: subscriber callbacks take no args and re-read through a
// snapshot; `set` only needs to notify. We iterate over a copy of each
// subscriber set so a callback that unsubscribes (or subscribes) mid-notify
// can't break iteration.

import type { CanvasParamState } from "./canvas-types";

export interface CanvasParamStore {
  /** The source-tagged param state: param → originId → entry. */
  state: CanvasParamState;
  /**
   * Record a param write from node `originId`, stamped with `updatedAt`, and
   * notify that param's subscribers. A canvas node's `originName` equals its
   * `id`, so it is stored as `originId` (contract §3).
   */
  set(param: string, value: unknown, originId: string, updatedAt: number): void;
  /** Remove this origin's entry for `param` and notify subscribers. */
  clear(param: string, originId: string): void;
  /**
   * Among the `allowedOriginIds` that have set `param`, return the value with
   * the max `updatedAt` (most-recent-wins). `undefined` if none of them set it.
   */
  getSnapshotFiltered(param: string, allowedOriginIds: string[]): unknown;
  /** Per-param subscriber set. Returns an unsubscribe fn. */
  subscribe(param: string, cb: () => void): () => void;
}

export function createCanvasParamStore(): CanvasParamStore {
  const state: CanvasParamState = {};
  const subscribers = new Map<string, Set<() => void>>();

  const notify = (param: string) => {
    const set = subscribers.get(param);
    if (!set) return;
    // Copy so a callback that unsubscribes (or subscribes) during notify
    // doesn't mutate the set we're iterating.
    for (const cb of [...set]) cb();
  };

  return {
    state,
    set(param: string, value: unknown, originId: string, updatedAt: number) {
      let byOrigin = state[param];
      if (!byOrigin) {
        byOrigin = {};
        state[param] = byOrigin;
      }
      byOrigin[originId] = {
        value,
        originId,
        originName: originId,
        updatedAt,
      };
      notify(param);
    },
    clear(param: string, originId: string) {
      const byOrigin = state[param];
      if (!byOrigin || !(originId in byOrigin)) return;
      delete byOrigin[originId];
      if (Object.keys(byOrigin).length === 0) delete state[param];
      notify(param);
    },
    getSnapshotFiltered(param: string, allowedOriginIds: string[]): unknown {
      const byOrigin = state[param];
      if (!byOrigin) return undefined;
      let best: { value: unknown; updatedAt: number } | undefined;
      for (const originId of allowedOriginIds) {
        const entry = byOrigin[originId];
        if (!entry) continue;
        if (!best || entry.updatedAt > best.updatedAt) {
          best = { value: entry.value, updatedAt: entry.updatedAt };
        }
      }
      return best?.value;
    },
    subscribe(param: string, cb: () => void) {
      let set = subscribers.get(param);
      if (!set) {
        set = new Set();
        subscribers.set(param, set);
      }
      set.add(cb);
      return () => {
        const current = subscribers.get(param);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) subscribers.delete(param);
      };
    },
  };
}
