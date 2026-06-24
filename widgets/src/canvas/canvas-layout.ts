// Directed layered (Data→Transform→View, left→right) auto-layout for canvas nodes
// missing a `position`. Used only when at least one node omits `position`. Nodes that
// already have a `position` keep it; position-less nodes are placed into DTV columns
// (column = pipeline depth, clamped by the node's layer) and stacked vertically.
// See features/canvas-layout-polish.md §2 and contracts/canvas-model.md §1
// (B-CANVAS-VIEW-07).

import dagre, {
  type EdgeLabel as DagreEdgeLabel,
  type GraphLabel as DagreGraphLabel,
  type NodeLabel as DagreNodeLabel,
} from "@dagrejs/dagre";

import {
  collectWidgetTypes,
  estimateSize,
  type Size,
} from "./canvas-node-size";
import type { CanvasNode } from "./canvas-types";

export type Layer = "data" | "transform" | "view";

const CONTROL_TYPES = new Set<string>([
  "slider",
  "dropdown",
  "text-input",
  "number-input",
  "text-area",
  "datetime-input",
  "color-input",
  "button",
  "form",
  "camera-input",
  "gallery-input",
]);
const DATA_TYPES = new Set<string>(["sql-runner", "sql-table"]);

/** Widget-type tiebreak for disconnected / ambiguous nodes (spec §2.1). */
function layerFromWidget(node: CanvasNode): Layer {
  const types = collectWidgetTypes(node.widget);
  const nonContainer = [...types].filter((t) => t !== "div" && t !== "form");
  const allControls =
    nonContainer.length > 0 && nonContainer.every((t) => CONTROL_TYPES.has(t));
  if (allControls) return "data";
  for (const t of types) if (DATA_TYPES.has(t)) return "data";
  if (types.has("transformer")) return "transform";
  return "view";
}

/** Classify each node into a DTV layer: explicit → edge topology → widget tiebreak. */
export function classifyLayers(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
): Map<string, Layer> {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const node of nodes) {
    inDeg.set(node.id, 0);
    outDeg.set(node.id, 0);
  }
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const out = new Map<string, Layer>();
  for (const node of nodes) {
    if (node.layer) {
      out.set(node.id, node.layer);
      continue;
    }
    const i = inDeg.get(node.id) ?? 0;
    const o = outDeg.get(node.id) ?? 0;
    if (i === 0 && o === 0) out.set(node.id, layerFromWidget(node));
    else if (i === 0) out.set(node.id, "data");
    else if (o === 0) out.set(node.id, "view");
    else out.set(node.id, "transform");
  }
  return out;
}

const RANK_SEP = 120; // horizontal gap between DTV ranks
const NODE_SEP = 48; // vertical gap between stacked nodes
const SUBCOL_SEP = 40; // horizontal gap between sub-columns within a rank
const TARGET_COL_H = 1100; // a rank taller than this wraps into more sub-columns
const MAX_SUBCOLS = 3; // cap sub-columns per rank
const COLLISION_GAP = 60; // px to clear an auto node past an authored one

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Nudge an auto-placed node's position to the right until it clears every
 * authored (`occupied`) rectangle — so a MIXED canvas (some authored positions,
 * some auto) never drops an auto node on top of an authored one.
 */
function avoidOccupied(
  position: { x: number; y: number },
  size: { width: number; height: number },
  occupied: Rect[],
): { x: number; y: number } {
  const next = { ...position };
  let guard = 0;
  while (guard < 100) {
    const rect = { ...next, width: size.width, height: size.height };
    const blocker = occupied.find((o) => overlaps(rect, o));
    if (!blocker) return next;
    next.x = blocker.x + blocker.width + COLLISION_GAP;
    guard += 1;
  }
  return next;
}

/** Longest-path depth from any source (in-degree 0). Cycles fall back to 0. */
function longestPathDepth(
  ids: string[],
  edges: { source: string; target: string }[],
): Map<string, number> {
  const succ = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const id of ids) {
    succ.set(id, []);
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    if (!succ.has(e.source) || !inDeg.has(e.target)) continue;
    succ.get(e.source)!.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  const remaining = new Map(inDeg);
  const queue = ids.filter((id) => (inDeg.get(id) ?? 0) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of succ.get(id) ?? []) {
      depth.set(t, Math.max(depth.get(t) ?? 0, (depth.get(id) ?? 0) + 1));
      remaining.set(t, (remaining.get(t) ?? 0) - 1);
      if ((remaining.get(t) ?? 0) === 0) queue.push(t);
    }
  }
  return depth;
}

/**
 * Deterministic DTV column layout (layered left→right by pipeline depth).
 * Column index = topological depth, clamped by the node's DTV layer (data→0,
 * view→rightmost). Within a column nodes stack vertically in input order.
 */
export function dtvLayout(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
  getSize: (n: CanvasNode) => Size,
): CanvasNode[] {
  const layers = classifyLayers(nodes, edges);
  const depth = longestPathDepth(
    nodes.map((n) => n.id),
    edges,
  );
  const maxDepth = Math.max(0, ...nodes.map((n) => depth.get(n.id) ?? 0));

  const columnOf = (n: CanvasNode): number => {
    const layer = layers.get(n.id)!;
    if (layer === "data") return 0;
    if (layer === "view") return maxDepth;
    // transform: keep its depth, but never column 0 or the rightmost view column.
    const d = depth.get(n.id) ?? 1;
    return maxDepth >= 2
      ? Math.min(Math.max(d, 1), maxDepth - 1)
      : Math.max(d, 0);
  };

  // Group position-less nodes by rank (authored-position nodes keep their spot).
  const byRank = new Map<number, CanvasNode[]>();
  for (const n of nodes) {
    if (n.position) continue;
    const c = columnOf(n);
    if (!byRank.has(c)) byRank.set(c, []);
    byRank.get(c)!.push(n);
  }

  // Authored-position nodes the auto layout must not land on (mixed canvases).
  const occupied: Rect[] = nodes
    .filter((n) => n.position)
    .map((n) => {
      const sz = getSize(n);
      return {
        x: n.position!.x,
        y: n.position!.y,
        width: sz.width,
        height: sz.height,
      };
    });

  // Each rank lays its nodes into balanced sub-columns: a rank whose stacked
  // height would exceed TARGET_COL_H wraps into 2–3 sub-columns so no single
  // column becomes a tall overlapping strip. Ranks flow left→right.
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  let rankX = 0;

  for (const c of ranks) {
    const rankNodes = byRank.get(c)!;
    const sizes = rankNodes.map((n) => getSize(n));
    const nodeW = Math.max(...sizes.map((s) => s.width));
    const totalH = sizes.reduce((sum, s) => sum + s.height + NODE_SEP, 0);
    const subCols = Math.min(
      MAX_SUBCOLS,
      Math.max(1, Math.ceil(totalH / TARGET_COL_H)),
    );

    // Greedy balance: each node joins the currently-shortest sub-column.
    const colHeights = new Array<number>(subCols).fill(0);
    rankNodes.forEach((n, i) => {
      let s = 0;
      for (let k = 1; k < subCols; k++)
        if (colHeights[k] < colHeights[s]) s = k;
      const candidate = {
        x: rankX + s * (nodeW + SUBCOL_SEP),
        y: colHeights[s],
      };
      // Only the rare mixed (authored + auto) canvas pays for collision checks.
      pos.set(
        n.id,
        occupied.length
          ? avoidOccupied(candidate, sizes[i], occupied)
          : candidate,
      );
      colHeights[s] += sizes[i].height + NODE_SEP;
    });

    rankX += subCols * nodeW + (subCols - 1) * SUBCOL_SEP + RANK_SEP;
  }

  return nodes.map((n) =>
    n.position ? n : { ...n, position: pos.get(n.id)! },
  );
}

// --- Opt-in dagre auto-layout (`layout: "dag"`) ----------------------------
// A true directed-graph layout: dagre ranks nodes by their edge topology and
// lays them out left→right (rankdir "LR") with generous, even spacing — so a
// graph reads as a clean dependency graph instead of per-folder stacks.
// Generous `ranksep` (column gap) keeps the ETL flow legible; `nodesep`/
// `edgesep` space siblings within a rank. The default DTV layout (dtvLayout) is
// unchanged — this is opt-in.
//
// DTV layer ordering: real pipeline edges are often sparse (e.g. dataset→udf
// lineage is heuristic and frequently absent, and many UDFs have no incident
// edge). Pure dagre then collapses every disconnected node into rank 0, which
// re-creates the very clustered left stack this layout is meant to fix. So we
// also pin each node's rank to its DTV layer (data < transform < view) via three
// hidden zero-size anchor nodes chained left→right; every node hangs off its
// layer's anchor. Real edges still refine ordering *within and past* a layer
// (a widget fed by a UDF lands right of it), but disconnected nodes fall into
// their layer's column instead of all piling into column 0.
const DAG_RANK_SEP = 160; // horizontal gap between dagre ranks (the LR columns)
const DAG_NODE_SEP = 56; // gap between sibling nodes within a rank
const DAG_EDGE_SEP = 24; // gap reserved for edges within a rank
const DAG_MARGIN = 16; // outer margin around the whole graph

/** Hidden anchor node ids, one per DTV layer (excluded from the output). */
const DAG_LAYER_ANCHOR: Record<Layer, string> = {
  data: "__dag_anchor_data",
  transform: "__dag_anchor_transform",
  view: "__dag_anchor_view",
};

/**
 * Dagre-driven directed-graph layout (`layout: "dag"`). Builds a dagre graph
 * with `rankdir: "LR"`, seeds each node's width/height from `getSize`, pins each
 * node to its DTV layer's rank (via hidden anchor nodes, so disconnected nodes
 * still spread Data→Transform→View instead of clustering at column 0), adds the
 * real edges, runs `dagre.layout()`, and reads each node's center back into a
 * top-left `position`. Only position-LESS nodes are assigned a position;
 * authored-position nodes keep theirs (they still join the graph as fixed-size
 * nodes so they influence ranking, but their computed center is ignored).
 * Returns `nodes` with positions filled in.
 */
export function dagLayout(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
  getSize: (n: CanvasNode) => Size,
): CanvasNode[] {
  // Typed with dagre's own label interfaces (the exact shapes `dagre.layout`
  // expects). A node label carries width/height IN; `dagre.layout` writes the
  // laid-out CENTER x/y onto the same label, read back below.
  const g = new dagre.graphlib.Graph<
    DagreGraphLabel,
    DagreNodeLabel,
    DagreEdgeLabel
  >({ directed: true });
  g.setGraph({
    rankdir: "LR",
    ranksep: DAG_RANK_SEP,
    nodesep: DAG_NODE_SEP,
    edgesep: DAG_EDGE_SEP,
    marginx: DAG_MARGIN,
    marginy: DAG_MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const s = getSize(n);
    g.setNode(n.id, { width: s.width, height: s.height });
  }

  // Hidden, zero-size layer anchors chained data → transform → view: this
  // guarantees the three layers occupy successive ranks (left→right) even when
  // no real edge crosses between them.
  for (const anchor of Object.values(DAG_LAYER_ANCHOR)) {
    g.setNode(anchor, { width: 0, height: 0 });
  }
  g.setEdge(DAG_LAYER_ANCHOR.data, DAG_LAYER_ANCHOR.transform);
  g.setEdge(DAG_LAYER_ANCHOR.transform, DAG_LAYER_ANCHOR.view);

  // Pin every node one rank past its layer's anchor (default minlen 1 — dagre's
  // network-simplex ranker requires minlen ≥ 1, so a node ranks at anchor + 1).
  // Real edges can push it further right (a widget fed by a UDF lands right of
  // it); a disconnected node simply sits in its layer's column.
  const layers = classifyLayers(nodes, edges);
  for (const n of nodes) {
    const layer = layers.get(n.id) ?? "transform";
    g.setEdge(DAG_LAYER_ANCHOR[layer], n.id);
  }

  for (const e of edges) {
    // Guard dangling edges (dagre throws if an endpoint isn't a known node).
    if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    if (n.position) return n; // authored position wins
    // After layout each node label carries x/y (its CENTER) + width/height.
    const placed = g.node(n.id);
    const cx = placed.x ?? 0;
    const cy = placed.y ?? 0;
    return {
      ...n,
      position: { x: cx - placed.width / 2, y: cy - placed.height / 2 },
    };
  });
}

/**
 * Assign positions to position-less canvas nodes via the DTV column layout.
 * If every node already has a `position`, returns `nodes` unchanged.
 * `getSize` supplies the effective size (authored ?? measured ?? estimate).
 */
export function autoLayout(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
  getSize: (n: CanvasNode) => Size = estimateSize,
): CanvasNode[] {
  if (nodes.every((n) => n.position)) return nodes;
  return dtvLayout(nodes, edges, getSize);
}
