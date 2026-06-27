// Canvas runtime wiring: turns the parsed canvas {nodes, edges} into one
// source-tagged param store + a per-node edge-gated FusedWidgetBridge whose SQL
// re-resolves through a per-node WidgetDataStore.
//
// Ported from the app's mcp-host `canvas/canvas-data.ts`. openfused's
// `data-store.ts` (WidgetDataStore, harvestInitialParams, DepMap) and
// `static-bridge.ts` (WidgetData, WidgetErrors) expose the SAME API the app's
// did, so the only reshaping is the import paths (../data-store, ../static-bridge
// are openfused's own modules).
//
// Why per-node stores: WidgetDataStore reads param values via
// `params.getSnapshotMany` for staleness + the resolve POST body. Giving each
// node a store backed by edge-gated params means a SQL widget only re-resolves
// for params its edges allow, and a per-node depMap (restricted to the node's own
// `_queryId`s) keeps node B's store from ever re-resolving node D's queries. The
// POST hits the SAME `resolveUrl` openfused's main.tsx threads from the
// structuredContent payload.
//
// Defaults are seeded per-origin (each node's own widget defaults under that
// node's id), so default values are edge-gated exactly like user-set values.

import type { FusedWidgetBridge } from "@fusedio/widget-sdk";

import { createPerNodeBridge } from "./canvas-bridge";
import type { ParsedEdge } from "./canvas-config";
import {
  createCanvasParamStore,
  type CanvasParamStore,
} from "./canvas-param-store";
import { createRouting } from "./canvas-routing";
import type { CanvasNode, JsonUiNode } from "./canvas-types";
import {
  WidgetDataStore,
  harvestInitialParams,
  type DepMap,
} from "../data-store";
import type { WidgetData, WidgetErrors } from "../static-bridge";

/** Collect every `_queryId` stamped into a widget subtree (server-resolved bindings). */
export function collectQueryIds(widget: JsonUiNode | undefined): string[] {
  const out = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = node as Record<string, unknown>;
    const props = rec.props as Record<string, unknown> | undefined;
    const qid = props?._queryId;
    if (typeof qid === "string" && qid !== "") out.add(qid);
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
  };
  visit(widget);
  return [...out];
}

/** Restrict a `{param -> [queryId]}` depMap to a node's own query ids. */
export function restrictDepMap(depMap: DepMap, qids: string[]): DepMap {
  const own = new Set(qids);
  const out: Record<string, string[]> = {};
  for (const [param, ids] of Object.entries(depMap)) {
    const kept = ids.filter((id) => own.has(id));
    if (kept.length > 0) out[param] = kept;
  }
  return out;
}

function serverInitialSnapshot(
  paramNames: readonly string[],
  harvested: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const param of paramNames) {
    out[param] = Object.prototype.hasOwnProperty.call(harvested, param)
      ? harvested[param]
      : undefined;
  }
  return out;
}

export interface CanvasDataInputs {
  /** The full canvas config, POSTed back so the resolver re-stamps the same qids. */
  config: unknown;
  data?: WidgetData;
  errors?: WidgetErrors;
  depMap?: DepMap;
  resolveUrl?: string;
  /** The host's base bridge (from useFusedWidgetBridge) — delegated to for sql/template/etc. */
  baseBridge: FusedWidgetBridge;
}

export interface CanvasRuntimeHooks {
  onStartLoading: (nodeId: string) => void;
  onStopLoading: (nodeId: string) => void;
}

export interface CanvasRuntime {
  store: CanvasParamStore;
  /** The edge-gated bridge for a node's widget subtree (provide via context to the node). */
  getNodeBridge: (nodeId: string) => FusedWidgetBridge;
}

/**
 * Build the canvas runtime. The renderer may pass a previous store when inputs
 * refresh so param state survives while per-node data stores rebuild.
 */
export function createCanvasRuntime(
  nodes: CanvasNode[],
  edges: ParsedEdge[],
  inputs: CanvasDataInputs,
  hooks: CanvasRuntimeHooks,
  now: () => number = Date.now,
  store: CanvasParamStore = createCanvasParamStore(),
): CanvasRuntime {
  const routing = createRouting(nodes, edges);
  const depMap: DepMap = inputs.depMap ?? {};
  const allParamNames = Object.keys(depMap);
  const serverSnapshot = serverInitialSnapshot(
    allParamNames,
    harvestInitialParams(inputs.config),
  );

  // 1) Seed each node's own widget defaults under that node's origin (gated like
  //    user-set values). updatedAt 0 so a real user set always supersedes.
  for (const node of nodes) {
    const harvested = harvestInitialParams(node.widget);
    for (const [param, value] of Object.entries(harvested)) {
      const existing = store.state[param]?.[node.id];
      if (
        existing &&
        (existing.updatedAt > 0 || Object.is(existing.value, value))
      ) {
        continue;
      }
      store.set(param, value, node.id, 0);
    }
  }

  // 2) Build a per-node bridge + per-node data store AFTER seeding so each
  //    store compares the host's cached rows against the node's live filtered view.
  const bridges = new Map<string, FusedWidgetBridge>();
  for (const node of nodes) {
    const allowedSources = routing.allowedSources(node.id);

    const baseGated = createPerNodeBridge(inputs.baseBridge, store, {
      nodeId: node.id,
      allowedSources,
      now,
      onStartLoading: hooks.onStartLoading,
      onStopLoading: hooks.onStopLoading,
    });

    const ownQids = collectQueryIds(node.widget);
    const nodeStore = new WidgetDataStore({
      data: inputs.data,
      errors: inputs.errors,
      depMap: restrictDepMap(depMap, ownQids),
      resolveUrl: inputs.resolveUrl,
      config: inputs.config,
      // Track ONLY this node's own queries. `config` is the FULL canvas config
      // (the resolver re-stamps the same ids), but without this the store would
      // walk it and treat EVERY node's queries as its own — re-resolving other
      // nodes' queries on mount and breaking per-node isolation. This node's own
      // param-free queries still resolve on first paint.
      queryIds: ownQids,
      // The cached rows came from the host's ungated full-config resolve. Seed
      // that backing snapshot so nodes whose gated view differs refetch before
      // serving rows resolved with inaccessible defaults.
      harvestedParams: serverSnapshot,
      params: baseGated.params,
    });

    // SQL re-resolves through THIS node's gated store, not the app-level one.
    const nodeBridge: FusedWidgetBridge = {
      ...baseGated,
      sql: {
        ...inputs.baseBridge.sql,
        query: (_sql, opts) => nodeStore.ensureFresh(opts?.queryId),
      },
    };
    bridges.set(node.id, nodeBridge);
  }

  return {
    store,
    getNodeBridge: (nodeId: string) => {
      const b = bridges.get(nodeId);
      if (b) return b;
      // Unknown node id (defensive) — fall back to the base bridge.
      return inputs.baseBridge;
    },
  };
}
