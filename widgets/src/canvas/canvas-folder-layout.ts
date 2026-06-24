// Folder-aware layout: position-less members cluster INSIDE their folder; the folder box is
// derived from the members' bounding box + padding when unauthored; authored folder
// position/size win; a collapsed folder is a summary bar. Folder-less nodes use the global
// DTV layout. Folders are organizational only — this module never touches edges/routing.
// See docs/specs/json-ui-canvas/features/canvas-folders.md §5/§7.

import type { ParsedFolder } from "./canvas-config";
import { autoLayout, dagLayout } from "./canvas-layout";
import { estimateSize, type Size } from "./canvas-node-size";
import type { CanvasNode } from "./canvas-types";

export interface FolderBox {
  id: string;
  title?: string;
  color?: string;
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_PAD = 28; // gap between the region border and its members
/** Gap between successive folder/ungrouped bands (along the band axis). */
export const FOLDER_BAND_GAP = 96;
const COLLAPSED_H = 48; // region height when collapsed (summary bar)
const COLLAPSED_MIN_W = 240; // min width of compact folder defaults
const EMPTY_EXPANDED_H = COLLAPSED_H + FOLDER_PAD * 2; // default height for expanded empty folders

type Edge = { source: string; target: string };

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(
  nodes: CanvasNode[],
  getSize: (n: CanvasNode) => Size,
): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = n.position!;
    const s = getSize(n);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Translate every node by (dx, dy) (returns new node objects). */
function shift(nodes: CanvasNode[], dx: number, dy: number): CanvasNode[] {
  return nodes.map((n) => ({
    ...n,
    position: { x: n.position!.x + dx, y: n.position!.y + dy },
  }));
}

/** Which way derived (position-less) folder bands flow. */
export type BandAxis = "vertical" | "horizontal";

/** The auto-layout algorithm for position-less nodes. */
export type LayoutMode = "dtv" | "dag";

export function layoutWithFolders(
  nodes: CanvasNode[],
  edges: Edge[],
  folders: ParsedFolder[],
  nodeFolder: Map<string, string>,
  getSize: (n: CanvasNode) => Size = estimateSize,
  bandAxis: BandAxis = "vertical",
  layoutMode: LayoutMode = "dtv",
): { nodes: CanvasNode[]; folderBoxes: FolderBox[] } {
  // Opt-in dagre layout: lay out ALL nodes GLOBALLY as one directed graph (the
  // real cross-folder edges drive ranking → a proper DAG), then derive each
  // folder's box as the bounding box of its placed members. No per-folder band
  // stacking. Default "dtv" (and any absent value) takes the band path below,
  // byte-identical to today.
  if (layoutMode === "dag") {
    return layoutWithFoldersDag(nodes, edges, folders, getSize);
  }

  // Fast path: no folders → existing behaviour, no boxes.
  if (folders.length === 0) {
    return { nodes: autoLayout(nodes, edges, getSize), folderBoxes: [] };
  }

  const horizontal = bandAxis === "horizontal";

  // Partition nodes into per-folder groups (config order) + ungrouped.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups: { folder: ParsedFolder; members: CanvasNode[] }[] = folders.map(
    (folder) => ({
      folder,
      members: folder.nodeIds
        .map((id) => byId.get(id))
        .filter((n): n is CanvasNode => !!n),
    }),
  );
  const ungrouped = nodes.filter((n) => !nodeFolder.has(n.id));

  const outNodes: CanvasNode[] = [];
  const folderBoxes: FolderBox[] = [];
  // Running coordinate for auto-placed (derived) bands along the band axis: a
  // vertical y (top) when stacking top→bottom, a horizontal x (left) when
  // flowing left→right. Bands start at the cross-axis origin (0).
  let bandPos = 0;

  for (const { folder, members } of groups) {
    // Lay out this folder's members as their own DTV sub-graph (internal edges only).
    const memberSet = new Set(members.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => memberSet.has(e.source) && memberSet.has(e.target),
    );
    const laid =
      members.length > 0 ? autoLayout(members, internalEdges, getSize) : [];
    const hasAuthored = members.some((n) => n.position);

    // Authored region wins; otherwise derive from members (or a default empty box).
    if (folder.position || folder.size) {
      // Place the member cluster's top-left at (pad, pad) inside the authored box — the label
      // bar is drawn externally above the box, so the top inset is symmetric padding.
      const b = laid.length > 0 ? boundsOf(laid, getSize) : undefined;
      // When the members carry no authored coords the box falls onto the band
      // flow (the running coordinate along the band axis; the cross axis at 0).
      const derivedX =
        b && hasAuthored ? b.minX - FOLDER_PAD : horizontal ? bandPos : 0;
      const derivedY =
        b && hasAuthored ? b.minY - FOLDER_PAD : horizontal ? 0 : bandPos;
      const contentWidth = b
        ? b.maxX - b.minX + FOLDER_PAD * 2
        : COLLAPSED_MIN_W;
      const derivedWidth =
        folder.collapsed || !b
          ? Math.max(COLLAPSED_MIN_W, contentWidth)
          : contentWidth;
      const derivedHeight = folder.collapsed
        ? COLLAPSED_H
        : b
          ? b.maxY - b.minY + FOLDER_PAD * 2
          : EMPTY_EXPANDED_H;
      const box: FolderBox = {
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: folder.collapsed,
        x: folder.position?.x ?? derivedX,
        y: folder.position?.y ?? derivedY,
        width: Math.max(folder.size?.width ?? derivedWidth, derivedWidth),
        height: folder.collapsed
          ? COLLAPSED_H
          : Math.max(folder.size?.height ?? derivedHeight, derivedHeight),
      };
      folderBoxes.push(box);
      if (!folder.collapsed && b) {
        outNodes.push(
          ...shift(
            laid,
            box.x + FOLDER_PAD - b.minX,
            box.y + FOLDER_PAD - b.minY,
          ),
        );
      } else {
        // Collapsed (or empty): members keep laid coords but are hidden by the renderer.
        outNodes.push(...laid);
      }
      bandPos = Math.max(
        bandPos,
        (horizontal ? box.x + box.width : box.y + box.height) + FOLDER_BAND_GAP,
      );
      continue;
    }

    if (folder.collapsed) {
      // Derived but collapsed: a summary bar. Anchored at the SAME derived spot
      // as the expanded region (members' bounds minus padding) when members
      // have authored positions, so toggling collapse never shifts the folder;
      // position-less member clusters stay in the band flow.
      let width = COLLAPSED_MIN_W;
      let x = horizontal ? bandPos : 0;
      let y = horizontal ? 0 : bandPos;
      if (laid.length > 0) {
        const b = boundsOf(laid, getSize);
        width = b.maxX - b.minX + FOLDER_PAD * 2;
        if (hasAuthored) {
          x = b.minX - FOLDER_PAD;
          y = b.minY - FOLDER_PAD;
        }
      }
      const boxWidth = Math.max(COLLAPSED_MIN_W, width);
      folderBoxes.push({
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: folder.collapsed,
        x,
        y,
        width: boxWidth,
        height: COLLAPSED_H,
      });
      // Hidden members keep their laid coords (renderer hides them visually).
      outNodes.push(...laid);
      bandPos = Math.max(
        bandPos,
        (horizontal ? x + boxWidth : y + COLLAPSED_H) + FOLDER_BAND_GAP,
      );
      continue;
    }

    if (laid.length === 0) {
      const box: FolderBox = {
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: false,
        x: horizontal ? bandPos : 0,
        y: horizontal ? 0 : bandPos,
        width: COLLAPSED_MIN_W,
        height: EMPTY_EXPANDED_H,
      };
      folderBoxes.push(box);
      bandPos += (horizontal ? box.width : box.height) + FOLDER_BAND_GAP;
      continue;
    }

    // Derived, expanded. Two cases:
    //  - Any authored-position member → the cluster already lives at absolute coords; bound the
    //    box around the members in place (don't relocate them into the band flow).
    //  - All members position-less → place the auto cluster in the current band; the box wraps
    //    it + padding.
    let placed: CanvasNode[];
    let box: FolderBox;
    if (hasAuthored) {
      // Members keep their absolute coords; derive a box that bounds them + symmetric padding.
      placed = laid;
      const pb = boundsOf(placed, getSize);
      box = {
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: false,
        x: pb.minX - FOLDER_PAD,
        y: pb.minY - FOLDER_PAD,
        width: pb.maxX - pb.minX + FOLDER_PAD * 2,
        height: pb.maxY - pb.minY + FOLDER_PAD * 2,
      };
    } else {
      // All members position-less: drop the auto cluster into the current band.
      // The cluster's top-left lands at (FOLDER_PAD, FOLDER_PAD) inside the box,
      // offset along the band axis by the band's running start; the box wraps it
      // + symmetric padding. Mirror the vertical math, swapping the band axis.
      const b = boundsOf(laid, getSize);
      const dx = (horizontal ? bandPos : 0) + FOLDER_PAD - b.minX;
      const dy = (horizontal ? 0 : bandPos) + FOLDER_PAD - b.minY;
      placed = shift(laid, dx, dy);
      const pb = boundsOf(placed, getSize);
      box = {
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: false,
        x: horizontal ? bandPos : 0,
        y: horizontal ? 0 : bandPos,
        width: horizontal
          ? pb.maxX - bandPos + FOLDER_PAD
          : pb.maxX + FOLDER_PAD,
        height: horizontal
          ? pb.maxY + FOLDER_PAD
          : pb.maxY - bandPos + FOLDER_PAD,
      };
    }
    bandPos = Math.max(
      bandPos,
      (horizontal ? box.x + box.width : box.y + box.height) + FOLDER_BAND_GAP,
    );
    outNodes.push(...placed);
    folderBoxes.push(box);
  }

  // Folder-less nodes: use the pre-folder global DTV, placed in a band after all
  // folders (below them when stacking vertically, to their right when flowing
  // horizontally), so the ungrouped tail never overlaps the folder bands.
  if (ungrouped.length > 0) {
    const globalLaid = new Map(
      autoLayout(nodes, edges, getSize).map((n): [string, CanvasNode] => [
        n.id,
        n,
      ]),
    );
    const laid = ungrouped.map((n) => globalLaid.get(n.id) ?? n);
    // Only shift the ones we auto-placed (authored-position ungrouped nodes keep absolute coords).
    const shifted = laid.map((n) => {
      const original = ungrouped.find((u) => u.id === n.id)!;
      if (original.position) return n; // authored → absolute, untouched
      const p = n.position!;
      return {
        ...n,
        position: horizontal
          ? { x: p.x + bandPos, y: p.y }
          : { x: p.x, y: p.y + bandPos },
      };
    });
    outNodes.push(...shifted);
  }

  return { nodes: outNodes, folderBoxes };
}

/**
 * Dagre (`layout: "dag"`) folder layout. Lays out EVERY node as one global
 * directed graph (so the real cross-folder edges — dataset → udf → widget —
 * drive ranking), then derives each folder's box as the bounding box of its
 * members' placed positions + padding. Ungrouped nodes keep their dagLayout
 * coordinates. Authored folder geometry wins; a collapsed folder is a summary
 * bar anchored at its members' bounds. There is NO per-folder band stacking —
 * positions come straight from the global DAG.
 */
function layoutWithFoldersDag(
  nodes: CanvasNode[],
  edges: Edge[],
  folders: ParsedFolder[],
  getSize: (n: CanvasNode) => Size,
): { nodes: CanvasNode[]; folderBoxes: FolderBox[] } {
  // One global DAG over all nodes. Position-less nodes get DAG coords; authored
  // nodes keep theirs (dagLayout already honours an authored `position`).
  const laidAll = dagLayout(nodes, edges, getSize);

  // No folders → just the global DAG, no boxes (parity with the dtv fast path).
  if (folders.length === 0) {
    return { nodes: laidAll, folderBoxes: [] };
  }

  const placedById = new Map(laidAll.map((n) => [n.id, n]));
  const folderBoxes: FolderBox[] = [];

  for (const folder of folders) {
    const members = folder.nodeIds
      .map((id) => placedById.get(id))
      .filter((n): n is CanvasNode => !!n);
    const b = members.length > 0 ? boundsOf(members, getSize) : undefined;

    // Authored geometry wins (position and/or size), exactly like the dtv path.
    if (folder.position || folder.size) {
      const derivedX = b ? b.minX - FOLDER_PAD : 0;
      const derivedY = b ? b.minY - FOLDER_PAD : 0;
      const contentWidth = b
        ? b.maxX - b.minX + FOLDER_PAD * 2
        : COLLAPSED_MIN_W;
      const derivedWidth =
        folder.collapsed || !b
          ? Math.max(COLLAPSED_MIN_W, contentWidth)
          : contentWidth;
      const derivedHeight = folder.collapsed
        ? COLLAPSED_H
        : b
          ? b.maxY - b.minY + FOLDER_PAD * 2
          : EMPTY_EXPANDED_H;
      folderBoxes.push({
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: folder.collapsed,
        x: folder.position?.x ?? derivedX,
        y: folder.position?.y ?? derivedY,
        width: Math.max(folder.size?.width ?? derivedWidth, derivedWidth),
        height: folder.collapsed
          ? COLLAPSED_H
          : Math.max(folder.size?.height ?? derivedHeight, derivedHeight),
      });
      continue;
    }

    // Derived, collapsed → a summary bar anchored at the members' bounds (so
    // toggling collapse never shifts the folder); members keep their DAG coords
    // and are hidden by the renderer.
    if (folder.collapsed) {
      const x = b ? b.minX - FOLDER_PAD : 0;
      const y = b ? b.minY - FOLDER_PAD : 0;
      const width = b
        ? Math.max(COLLAPSED_MIN_W, b.maxX - b.minX + FOLDER_PAD * 2)
        : COLLAPSED_MIN_W;
      folderBoxes.push({
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: true,
        x,
        y,
        width,
        height: COLLAPSED_H,
      });
      continue;
    }

    // Derived, expanded, empty → a default region box at the origin.
    if (!b) {
      folderBoxes.push({
        id: folder.id,
        title: folder.title,
        color: folder.color,
        collapsed: false,
        x: 0,
        y: 0,
        width: COLLAPSED_MIN_W,
        height: EMPTY_EXPANDED_H,
      });
      continue;
    }

    // Derived, expanded → the bounding box of the members' placed positions + padding.
    folderBoxes.push({
      id: folder.id,
      title: folder.title,
      color: folder.color,
      collapsed: false,
      x: b.minX - FOLDER_PAD,
      y: b.minY - FOLDER_PAD,
      width: b.maxX - b.minX + FOLDER_PAD * 2,
      height: b.maxY - b.minY + FOLDER_PAD * 2,
    });
  }

  return { nodes: laidAll, folderBoxes };
}
