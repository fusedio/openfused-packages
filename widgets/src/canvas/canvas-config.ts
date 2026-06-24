// Reads and validates a `canvas` component's props.{nodes,edges,folders,viewport}.
// Drops duplicate nodes, self / duplicate / dangling edges, records config errors,
// and builds the O(1) edgeConnectionKeys set. See the canvas-model contract §4–§5.

import type {
  CanvasEdge,
  CanvasFolder,
  CanvasNode,
  CanvasProps,
} from "./canvas-types";

export interface ParsedEdge {
  id: string;
  source: string;
  target: string;
  directional: boolean;
}

export interface ParsedFolder {
  id: string;
  nodeIds: string[];
  title?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  color?: string;
  collapsed: boolean;
}

export interface ParsedCanvas {
  nodes: CanvasNode[];
  edges: ParsedEdge[];
  /** Directed "source->target" keys for O(1) existence checks. */
  edgeConnectionKeys: Set<string>;
  errors: string[];
  /** Validated folders (organizational regions; never affect routing). */
  folders: ParsedFolder[];
  /** O(1) node id → owning folder id (a node is in at most one folder). */
  nodeFolder: Map<string, string>;
  /** How derived (position-less) folder bands flow. Defaults to "vertical". */
  folderBands: "vertical" | "horizontal";
  /** Auto-layout algorithm for position-less nodes. Defaults to "dtv". */
  layout: "dtv" | "dag";
}

export function parseCanvasConfig(
  props: Partial<CanvasProps> | undefined,
): ParsedCanvas {
  const errors: string[] = [];
  const rawNodes = Array.isArray(props?.nodes) ? props!.nodes : [];
  const nodes: CanvasNode[] = [];

  const ids = new Set<string>();
  for (const n of rawNodes) {
    if (ids.has(n.id)) {
      errors.push(`Duplicate node id "${n.id}"`);
      continue;
    }
    ids.add(n.id);
    nodes.push(n);
  }

  const seenPairs = new Set<string>(); // unordered pair → dedupe in either direction
  const edgeConnectionKeys = new Set<string>();
  const edges: ParsedEdge[] = [];
  const rawEdges: CanvasEdge[] = Array.isArray(props?.edges)
    ? props!.edges
    : [];

  for (const e of rawEdges) {
    if (e.source === e.target) {
      console.warn(`canvas: dropping self-edge "${e.source}"`);
      continue;
    }
    if (!ids.has(e.source) || !ids.has(e.target)) {
      console.warn(`canvas: dropping dangling edge "${e.source}->${e.target}"`);
      continue;
    }
    const pair = [e.source, e.target].sort().join("|");
    if (seenPairs.has(pair)) {
      console.warn(
        `canvas: dropping duplicate edge "${e.source}->${e.target}"`,
      );
      continue;
    }
    seenPairs.add(pair);
    edges.push({
      id: e.id ?? `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      directional: e.directional ?? true,
    });
    edgeConnectionKeys.add(`${e.source}->${e.target}`);
  }

  const rawFolders: CanvasFolder[] = Array.isArray(props?.folders)
    ? props!.folders
    : [];
  const folders: ParsedFolder[] = [];
  const nodeFolder = new Map<string, string>();
  const folderIds = new Set<string>();

  for (const f of rawFolders) {
    if (ids.has(f.id)) {
      errors.push(
        `Folder id "${f.id}" collides with a node id (folders and nodes share one id space)`,
      );
      continue;
    }
    if (folderIds.has(f.id)) {
      errors.push(`Duplicate folder id "${f.id}"`);
      continue;
    }
    folderIds.add(f.id);

    const memberIds: string[] = [];
    const rawMembers = Array.isArray(f.nodeIds) ? f.nodeIds : [];
    for (const nodeId of rawMembers) {
      if (!ids.has(nodeId)) {
        console.warn(
          `canvas: dropping dangling folder member "${nodeId}" in folder "${f.id}"`,
        );
        continue;
      }
      if (nodeFolder.has(nodeId)) {
        console.warn(
          `canvas: node "${nodeId}" is already in folder "${nodeFolder.get(
            nodeId,
          )}"; ignoring its membership in "${f.id}"`,
        );
        continue;
      }
      nodeFolder.set(nodeId, f.id);
      memberIds.push(nodeId);
    }

    folders.push({
      id: f.id,
      nodeIds: memberIds,
      title: f.title,
      position: f.position,
      size: f.size,
      color: f.color,
      collapsed: f.collapsed ?? false,
    });
  }

  // Band axis for derived (position-less) folders; defaults to vertical. Any
  // value other than the explicit "horizontal" falls back to "vertical".
  const folderBands: "vertical" | "horizontal" =
    props?.folderBands === "horizontal" ? "horizontal" : "vertical";

  // Auto-layout algorithm; defaults to "dtv". Any value other than the explicit
  // "dag" falls back to "dtv" (so an absent/unknown value is byte-identical to today).
  const layout: "dtv" | "dag" = props?.layout === "dag" ? "dag" : "dtv";

  return {
    nodes,
    edges,
    edgeConnectionKeys,
    errors,
    folders,
    nodeFolder,
    folderBands,
    layout,
  };
}
