// Canvas routing. Computes, per node, the set of node ids whose param values
// that node is allowed to see (canvas-model contract §3):
//
//   For a node N, the allowed sources are:
//     - N itself, plus
//     - the source of every edge whose target is N (incoming), plus
//     - the target of every edge (N -> T) whose `directional` is false (outgoing bidirectional).
//
// This is the same rule as the app's `getAllowedSourcesForUdf`
// (json-ui/param-routing-utils.ts), reconciled into ONE self-contained module:
// the app util threads a separate udfUniqueId / udfName per node and falls back
// through `edge.data` / node-lookup variants because the workbench has both a
// session id and a workspace name per node. A canvas node has no such split — a
// node IS its routing key (its `id`) — so we collapse to a single routing key
// and drop the udfUniqueId/udfName fan-out. Net semantics are identical: itself
// + incoming sources + outgoing-bidirectional targets, deduped, self first.
// No app-internal imports (the app util imports Jotai studio-state); pure.

import type { ParsedEdge } from "./canvas-config";
import type { CanvasNode } from "./canvas-types";

export interface Routing {
  /** Node ids whose param values the given node id is allowed to see (incl. itself). */
  allowedSources(id: string): string[];
}

interface RoutingNodeLike {
  id: string;
  routingKey: string;
}

interface RoutingEdgeLike {
  source: string;
  target: string;
  sourceRoutingKey: string;
  targetRoutingKey: string;
  isDirectional: boolean;
}

// Pure core, reduced to a single routing key per node (the canvas node id).
function computeAllowedSources(
  nodes: RoutingNodeLike[],
  edges: RoutingEdgeLike[],
  routingKey: string,
): string[] {
  const currentNode = nodes.find((node) => node.routingKey === routingKey);
  if (!currentNode) {
    return [];
  }

  const incomingEdges = edges.filter((edge) => edge.target === currentNode.id);
  const outgoingBidirectionalEdges = edges.filter(
    (edge) => edge.source === currentNode.id && edge.isDirectional === false,
  );

  const sources: string[] = [];
  const seen = new Set<string>();
  const pushSource = (key: string | undefined) => {
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    sources.push(key);
  };

  // N itself.
  pushSource(routingKey);

  // Sources of incoming edges.
  for (const edge of incomingEdges) {
    pushSource(edge.sourceRoutingKey);
  }

  // Targets of outgoing bidirectional edges.
  for (const edge of outgoingBidirectionalEdges) {
    pushSource(edge.targetRoutingKey);
  }

  return sources;
}

/**
 * Build a routing adapter from the parsed canvas `{ nodes, edges }`. Results are
 * memoized per node id in a `Map` cache.
 */
export function createRouting(
  nodes: CanvasNode[],
  edges: ParsedEdge[],
): Routing {
  // Each canvas node id occupies the util's routing-key slot.
  const routingNodes: RoutingNodeLike[] = nodes.map((node) => ({
    id: node.id,
    routingKey: node.id,
  }));
  const routingEdges: RoutingEdgeLike[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    sourceRoutingKey: edge.source,
    targetRoutingKey: edge.target,
    isDirectional: edge.directional,
  }));

  const cache = new Map<string, string[]>();

  return {
    allowedSources(id: string): string[] {
      const cached = cache.get(id);
      if (cached) {
        return cached;
      }
      const result = computeAllowedSources(routingNodes, routingEdges, id);
      cache.set(id, result);
      return result;
    },
  };
}
