// Per-node `FusedWidgetBridge` for the canvas: makes param routing edge-gated
// (canvas-model contract §3). Ported verbatim from the app's mcp-host
// `canvas/canvas-bridge.ts` — openfused's `FusedWidgetBridge` (static-bridge.ts)
// is the SAME SDK shape, so nothing here needed reshaping.
//
// Each canvas node renders its widget subtree behind its OWN bridge. The
// per-node bridge is a thin view over the shared base bridge + the canvas param
// store:
//   - It DELEGATES every node-agnostic capability (sql, template, signUrl, log,
//     uploads, udfs, routing) to `base` via `...base` spread, so those keep the
//     base's identity and behaviour untouched.
//   - It OVERRIDES `node`, `params`, and `edges` so reads/writes are scoped to
//     this node: param reads are filtered to the node's edge-derived
//     `allowedSources` (most-recent-wins via the store), writes are tagged with
//     this node's id as the origin, and explicit edge-animation calls bubble up
//     so the canvas can animate the right edges.
//
// `params` matches `FusedWidgetBridge["params"]` exactly (widget-sdk bridge.ts
// `ParamBridge`): `set` keeps the 3rd `ParameterMessageType` arg in its
// signature so `useFusedParam` calls it unchanged (the store ignores the type —
// source-tagging + recency is what gates routing, not the message type).

import type {
  FusedWidgetBridge,
  ParameterMessageType,
} from "@fusedio/widget-sdk";

import type { CanvasParamStore } from "./canvas-param-store";

export interface PerNodeBridgeOptions {
  /** This node's stable canvas id — the routing key and write origin. */
  nodeId: string;
  /**
   * The origin ids this node may read from (its own id plus edge-connected
   * sources; see `createRouting().allowedSources`). Param reads filter to this
   * set, so an upstream node's value only reaches a node it has an edge to.
   */
  allowedSources: string[];
  /** Clock for the `updatedAt` write stamp. Defaults to `Date.now`. */
  now?: () => number;
  /** Bubble the edge-animation loading start up to the canvas (by node id). */
  onStartLoading?: (id: string) => void;
  /** Bubble the edge-animation loading stop up to the canvas (by node id). */
  onStopLoading?: (id: string) => void;
}

export function createPerNodeBridge(
  base: FusedWidgetBridge,
  store: CanvasParamStore,
  opts: PerNodeBridgeOptions,
): FusedWidgetBridge {
  const { nodeId, allowedSources, now, onStartLoading, onStopLoading } = opts;
  const clock = now ?? Date.now;

  const getFiltered = (param: string): unknown =>
    store.getSnapshotFiltered(param, allowedSources);

  const params: FusedWidgetBridge["params"] = {
    subscribe(param: string, cb: () => void) {
      return store.subscribe(param, cb);
    },
    getSnapshot(param: string) {
      return getFiltered(param);
    },
    subscribeMany(paramNames: readonly string[], cb: () => void) {
      const unsubs = paramNames.map((param) => store.subscribe(param, cb));
      return () => {
        for (const u of unsubs) u();
      };
    },
    getSnapshotMany(paramNames: readonly string[]) {
      const out: Record<string, unknown> = {};
      // Include EVERY requested key (even when filtered to undefined) so a
      // reader whose allowed sources never set the param sees `undefined`
      // explicitly — `getSnapshotMany(["region"]) === { region: undefined }`.
      for (const param of paramNames) out[param] = getFiltered(param);
      return out;
    },
    set(param: string, value: unknown, _type?: ParameterMessageType) {
      store.set(param, value, nodeId, clock());
      // Mirror the write to the page-level params store so a human editing a
      // canvas INPUT surfaces to the session/parley feedback channel
      // (`widget watch`) exactly like a flat-widget input does — otherwise
      // canvas param edits stay trapped in the edge-gated store and the agent
      // never sees them (json-ui-canvas.md § 3b Feedback mirror).
      // Edge-gating still governs node-to-node READS (getSnapshotFiltered); this
      // touches only the flat feedback snapshot. Safe re: re-resolution: the
      // page-level WidgetDataStore is LAZY (no param subscription) so this fires
      // the feedback reporters only and triggers no duplicate resolve. Node
      // defaults are pre-seeded in the canvas store (canvas-data.ts), so inputs
      // don't broadcast on mount → only real user edits mirror (no load noise).
      base.params.set(param, value, _type);
    },
    clear(param: string) {
      store.clear(param, nodeId);
      base.params.clear(param);
    },
  };

  return {
    ...base,
    node: { udfUniqueId: nodeId, udfName: nodeId },
    params,
    edges: {
      startLoading: () => onStartLoading?.(nodeId),
      stopLoading: () => onStopLoading?.(nodeId),
    },
  };
}
