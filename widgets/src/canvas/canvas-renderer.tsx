/**
 * The canvas renderer: maps a parsed `canvas` config onto a read-only ReactFlow
 * graph. Each node renders its widget subtree (via CanvasNode → openfused's
 * RenderNode) under an edge-gated bridge from the canvas runtime; edges animate
 * while their source node is broadcasting. View mode only — structure is
 * read-only.
 *
 * Ported from the app's mcp-host `canvas/canvas-renderer.tsx`. RESHAPING:
 *   - `ComponentRenderProps` comes from `@fusedio/widget-sdk` (not
 *     `@json-render/react`).
 *   - The host data plane (`config/data/errors/depMap/resolveUrl`) is read from
 *     openfused's own `CanvasHostContext` (published by main.tsx around the
 *     render tree), NOT the app's `CanvasHostContext`. There is no `registry` to
 *     thread — CanvasNode renders through openfused's `RenderNode`.
 */
import React from "react";

import {
  FusedWidgetBridgeContext,
  useFusedWidgetBridge,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { RenderNode, type UINode } from "../render";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";

import { CanvasBackground } from "./canvas-background";
import { isFeedbackWrite, useCanvasComments } from "./canvas-comments";
import {
  CanvasCommentsOverlay,
  type CanvasCommentsHandle,
  type NodeBox,
} from "./canvas-comments-overlay";
import { parseCanvasConfig } from "./canvas-config";
import { CanvasControls } from "./canvas-controls";
import {
  createCanvasRuntime,
  type CanvasDataInputs,
  type CanvasRuntime,
} from "./canvas-data";
import { CanvasDataflowEdge } from "./canvas-edge";
import {
  CanvasFolderRegion,
  CanvasFolderTitle,
  FOLDER_TITLE_BAR_HEIGHT,
} from "./canvas-folder";
import { layoutWithFolders } from "./canvas-folder-layout";
import { CanvasFullscreenOverlay } from "./canvas-fullscreen-overlay";
import { useCanvasHost } from "./canvas-host-context";
import { CanvasNode } from "./canvas-node";
import { CanvasNodeDrawer } from "./canvas-node-drawer";
import { estimateSize } from "./canvas-node-size";
import type {
  CanvasNode as CanvasNodeModel,
  CanvasProps,
} from "./canvas-types";

const nodeTypes: NodeTypes = {
  "json-ui": CanvasNode,
  "folder-region": CanvasFolderRegion,
  "folder-title": CanvasFolderTitle,
};
const edgeTypes: EdgeTypes = {
  dataflow: CanvasDataflowEdge,
};
const proOptions = { hideAttribution: true } as const;
const RUN_PULSE_MS = 800;

/**
 * A node's box. An authored `size` is fixed exactly. Otherwise the node is
 * width-bounded (per-type estimate) but content-sized in height (auto).
 */
function nodeStyle(n: CanvasNodeModel): React.CSSProperties {
  if (n.size) return { width: n.size.width, height: n.size.height };
  return { width: estimateSize(n).width };
}

/** Does this node's widget carry any `props.sql` (i.e. is it data-bound)? Static
 * cards (dataset schema / UDF source / notes) have none, so they never show the
 * first-load spinner (`CanvasHostValue.dataLoading`). Early-exits on first hit. */
function isDataBoundNode(widget: unknown): boolean {
  let found = false;
  const visit = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    const rec = n as Record<string, unknown>;
    const props = rec.props as Record<string, unknown> | undefined;
    if (props && typeof props.sql === "string" && props.sql.trim() !== "") {
      found = true;
      return;
    }
    if (Array.isArray(rec.children)) rec.children.forEach(visit);
  };
  visit(widget);
  return found;
}

// The canvas signal accent (running/flowing edge, selection ring, param-flow
// breath). Defined inline on the surface so the edge/breath vars always resolve.
const CANVAS_ACCENT = "oklch(0.72 0.17 248)"; // bright azure blue
const CANVAS_SURFACE_STYLE = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 640,
  "--canvas-accent": CANVAS_ACCENT,
  "--canvas-accent-ring":
    "color-mix(in oklab, var(--canvas-accent) 55%, transparent)",
  "--canvas-accent-soft":
    "color-mix(in oklab, var(--canvas-accent) 14%, transparent)",
} as React.CSSProperties;
const CONFIG_ERROR_BANNER_STYLE = {
  position: "absolute",
  top: 12,
  left: 12,
  right: 12,
  zIndex: 10,
  pointerEvents: "none",
} as React.CSSProperties;

/** Reduced-motion preference (JS — a CSS @media query can't gate fitView's rAF tween). */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduce;
}

function CanvasConfigErrorBanner({ errors }: { errors: string[] }) {
  return (
    <div role="alert" aria-live="polite" style={CONFIG_ERROR_BANNER_STYLE}>
      <div
        style={{
          borderRadius: "var(--ofw-radius-sm, 7px)",
          border: "1px solid var(--ofw-danger, #ff6470)",
          background: "var(--ofw-card, #0d1219)",
          padding: 12,
          color: "var(--ofw-text, #e7ecf3)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ofw-danger, #ff6470)",
          }}
        >
          Canvas configuration issue
        </div>
        <pre
          style={{
            margin: "4px 0 0",
            whiteSpace: "pre-wrap",
            fontSize: 12,
            color: "var(--ofw-danger, #ff6470)",
          }}
        >
          {errors.join("\n")}
        </pre>
      </div>
    </div>
  );
}

function CanvasInner({ element }: ComponentRenderProps) {
  const host = useCanvasHost();
  const baseBridge = useFusedWidgetBridge();
  const rawProps = React.useMemo(
    () => (element.props ?? {}) as Partial<CanvasProps>,
    [element.props],
  );

  const parsed = React.useMemo(() => parseCanvasConfig(rawProps), [rawProps]);

  // Ephemeral collapse overrides (Workbench parity): clicking a folder's title
  // bar toggles it. Pure view state — resets on the next agent push/re-render,
  // never persisted (the widget is a stateless render; authored `collapsed`
  // stays the source of truth in the config).
  const [collapseOverrides, setCollapseOverrides] = React.useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const toggleFolderCollapsed = React.useCallback(
    (id: string) => {
      setCollapseOverrides((prev) => {
        const base = parsed.folders.find((f) => f.id === id);
        if (!base) return prev;
        const next = new Map(prev);
        next.set(id, !(prev.get(id) ?? base.collapsed));
        return next;
      });
    },
    [parsed.folders],
  );
  // A push that changes the folder set invalidates stale overrides wholesale.
  const folderIdSignature = React.useMemo(
    () =>
      parsed.folders
        .map((f) => f.id)
        .sort()
        .join(","),
    [parsed.folders],
  );
  React.useEffect(() => {
    setCollapseOverrides(new Map());
  }, [folderIdSignature]);
  const effectiveFolders = React.useMemo(
    () =>
      parsed.folders.map((f) => {
        const o = collapseOverrides.get(f.id);
        return o === undefined || o === f.collapsed
          ? f
          : { ...f, collapsed: o };
      }),
    [parsed.folders, collapseOverrides],
  );

  // Heights come from a deterministic content estimate (canvas-node-size.ts),
  // NOT a runtime measure: charts render asynchronously, so measuring at mount
  // races the chart and under-spaces the column → tall chart nodes overlap.
  const sizeOf = React.useCallback(
    (n: CanvasNodeModel) => n.size ?? estimateSize(n),
    [],
  );
  const { nodes: laidOut, folderBoxes } = React.useMemo(
    () =>
      layoutWithFolders(
        parsed.nodes,
        parsed.edges,
        effectiveFolders,
        parsed.nodeFolder,
        sizeOf,
        parsed.folderBands,
        parsed.layout,
      ),
    [parsed, effectiveFolders, sizeOf],
  );

  // Members of a collapsed folder are hidden; so is any edge incident to a
  // hidden member. Routing is unchanged; only drawing.
  const hiddenNodeIds = React.useMemo(() => {
    const hidden = new Set<string>();
    for (const f of effectiveFolders) {
      if (f.collapsed) for (const id of f.nodeIds) hidden.add(id);
    }
    return hidden;
  }, [effectiveFolders]);

  const memberCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const f of parsed.folders) m.set(f.id, f.nodeIds.length);
    return m;
  }, [parsed.folders]);

  // Member display names per folder — the collapsed region's summary chips.
  const memberTitlesByFolder = React.useMemo(() => {
    const titleById = new Map(
      parsed.nodes.map((n) => [n.id, n.title ?? n.id] as const),
    );
    const m = new Map<string, string[]>();
    for (const f of parsed.folders) {
      m.set(
        f.id,
        f.nodeIds.map((id) => titleById.get(id) ?? id),
      );
    }
    return m;
  }, [parsed.folders, parsed.nodes]);

  // Which source nodes are mid-broadcast (drives edge + node animation). Cleared
  // after a short settle so motion is a "flow" pulse, not a permanent state.
  const [runningSources, setRunningSources] = React.useState<Set<string>>(
    () => new Set<string>(),
  );
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearRunning = React.useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setRunningSources((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  const onStartLoading = React.useCallback(
    (id: string) => {
      setRunningSources((s) => {
        if (s.has(id)) return s;
        const next = new Set(s);
        next.add(id);
        return next;
      });
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => clearRunning(id), RUN_PULSE_MS),
      );
    },
    [clearRunning],
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  // Which node (if any) is expanded to fill the viewport (node fullscreen).
  const [fullscreenNodeId, setFullscreenNodeId] = React.useState<string | null>(
    null,
  );
  const onFullscreen = React.useCallback(
    (nodeId: string) => setFullscreenNodeId(nodeId),
    [],
  );
  const closeFullscreen = React.useCallback(
    () => setFullscreenNodeId(null),
    [],
  );
  React.useEffect(() => {
    if (fullscreenNodeId && hiddenNodeIds.has(fullscreenNodeId)) {
      setFullscreenNodeId(null);
    }
  }, [fullscreenNodeId, hiddenNodeIds]);

  // Node peek-drawer (config `nodePeek`): which node (if any) is peeked open in
  // the side drawer. Enabled by the canvas config; the host (pipeline) supplies
  // the drawer content. Mirrors the fullscreen state above (clear when hidden).
  const nodePeekEnabled = rawProps.nodePeek === true;
  const [peekNodeId, setPeekNodeId] = React.useState<string | null>(null);
  const openPeek = React.useCallback(
    (nodeId: string) => setPeekNodeId(nodeId),
    [],
  );
  const closePeek = React.useCallback(() => setPeekNodeId(null), []);
  React.useEffect(() => {
    if (peekNodeId && hiddenNodeIds.has(peekNodeId)) setPeekNodeId(null);
  }, [peekNodeId, hiddenNodeIds]);

  const runtimeStoreRef = React.useRef<CanvasRuntime["store"] | null>(null);
  const runtime = React.useMemo(() => {
    const inputs: CanvasDataInputs = {
      config: host.config,
      data: host.data,
      errors: host.errors,
      depMap: host.depMap,
      resolveUrl: host.resolveUrl,
      baseBridge,
    };
    // parsed.nodes, NOT laidOut: the runtime only reads node ids/widgets
    // (routing + default harvesting) — positions are irrelevant. Depending on
    // laidOut rebuilt the runtime (and re-resolved every node's data) on every
    // ephemeral folder collapse/expand, blanking the whole canvas when the
    // page's resolve tokens had gone stale.
    const nextRuntime = createCanvasRuntime(
      parsed.nodes,
      parsed.edges,
      inputs,
      {
        onStartLoading,
        onStopLoading: clearRunning,
      },
      undefined,
      runtimeStoreRef.current ?? undefined,
    );
    runtimeStoreRef.current = nextRuntime.store;
    return nextRuntime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parsed.nodes,
    parsed.edges,
    host.config,
    host.data,
    host.errors,
    host.depMap,
    host.resolveUrl,
    baseBridge,
    onStartLoading,
    clearRunning,
  ]);

  const folderNodes = React.useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const box of folderBoxes) {
      out.push({
        id: `folder-region:${box.id}`,
        type: "folder-region",
        position: { x: box.x, y: box.y },
        data: {
          box,
          memberTitles: memberTitlesByFolder.get(box.id),
          onToggleCollapsed: toggleFolderCollapsed,
        },
        zIndex: -1,
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
      });
      out.push({
        id: `folder-title:${box.id}`,
        type: "folder-title",
        // Label bar sits just above the region's top edge (a 4px gap).
        position: { x: box.x, y: box.y - FOLDER_TITLE_BAR_HEIGHT - 4 },
        data: {
          box,
          memberCount: memberCounts.get(box.id),
          width: box.width,
          onToggleCollapsed: toggleFolderCollapsed,
        },
        zIndex: 1,
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
      });
    }
    return out;
  }, [folderBoxes, memberCounts, memberTitlesByFolder, toggleFolderCollapsed]);

  const rfNodes = React.useMemo<Node[]>(
    () => [
      ...folderNodes,
      // Collapsed-folder members stay MOUNTED but invisible (visibility:hidden,
      // not filtered out): they are often param SOURCES (dropdowns/sliders), and
      // unmounting them drops their broadcast params — every downstream query
      // re-resolved empty and the whole canvas blanked. Collapse is a drawing
      // concern only; dataflow must keep running.
      ...laidOut.map((n) => ({
        id: n.id,
        type: "json-ui",
        position: n.position ?? { x: 0, y: 0 },
        style: hiddenNodeIds.has(n.id)
          ? {
              ...nodeStyle(n),
              visibility: "hidden" as const,
              pointerEvents: "none" as const,
            }
          : nodeStyle(n),
        data: {
          node: n,
          bridge: runtime.getNodeBridge(n.id),
          running: runningSources.has(n.id),
          // First-resolve spinner: data-bound nodes only, opt-in via
          // host.dataLoading (pipeline overview). Off everywhere else.
          loading: !!host.dataLoading && isDataBoundNode(n.widget),
          // The Overview canvas hides each node's fullscreen button (host flag):
          // a name-only node has nothing to maximize. Omitting onFullscreen here
          // makes CanvasNode drop the button entirely.
          onFullscreen: host.disableNodeFullscreen ? undefined : onFullscreen,
          // When the canvas config enables peek, a node click opens the drawer
          // (and cancels the node's default link navigation). Off → unset, so
          // node links behave exactly as before.
          onPeek: nodePeekEnabled ? openPeek : undefined,
        },
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    ],
    [
      folderNodes,
      laidOut,
      hiddenNodeIds,
      runtime,
      runningSources,
      host.dataLoading,
      host.disableNodeFullscreen,
      onFullscreen,
      nodePeekEnabled,
      openPeek,
    ],
  );

  const rfEdges = React.useMemo<Edge[]>(
    () =>
      parsed.edges
        .filter(
          (e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target),
        )
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "dataflow",
          data: {
            directional: e.directional,
            running: runningSources.has(e.source),
          },
        })),
    [parsed.edges, hiddenNodeIds, runningSources],
  );

  const hasViewport = !!rawProps.viewport;
  const [fitViewOnMount, setFitViewOnMount] = React.useState(
    () => !hasViewport,
  );
  const reduceMotion = usePrefersReducedMotion();
  const fitViewOptions = React.useMemo(
    () => ({
      padding: rawProps.fitViewPadding ?? 0.1,
      maxZoom: 1,
      // Animate the on-load fit (slow / ease-out); instant under reduced motion.
      duration: reduceMotion ? 0 : 600,
      ease: (t: number) => 1 - Math.pow(1 - t, 3),
    }),
    [rawProps.fitViewPadding, reduceMotion],
  );
  const onInit = React.useCallback(() => {
    setFitViewOnMount(false);
  }, []);

  // Re-fit whenever the NODE SET changes — the initial load and every agent
  // `widget push` that adds/removes nodes (params reset per push, so a pushed
  // view is a fresh layout). Keyed on the node-id signature so comment- or
  // param-only changes never refit (a user's manual pan is preserved). Skipped
  // when the config pins an explicit viewport.
  const { fitView } = useReactFlow();
  // True once ReactFlow has measured every node. A single rAF is NOT enough —
  // node dimensions resolve asynchronously (and later still when the canvas is
  // mounted in a late-sizing flex container, e.g. the app's board page), so
  // fitting before this fits stale/zero-size bounds and strands nodes
  // off-screen. Gate the fit on it.
  const nodesInitialized = useNodesInitialized();
  const nodeIdSignature = React.useMemo(
    () =>
      laidOut
        .map((n) => n.id)
        .sort()
        .join(","),
    [laidOut],
  );
  React.useEffect(() => {
    if (hasViewport || !nodesInitialized) return;
    // rAF so the freshly-measured nodes are painted before we frame.
    const raf = requestAnimationFrame(() => fitView(fitViewOptions));
    return () => cancelAnimationFrame(raf);
  }, [nodeIdSignature, nodesInitialized, hasViewport, fitView, fitViewOptions]);

  // Late-sizing containers: when the canvas mounts inside a flex parent that
  // only gets its real dimensions AFTER first paint (e.g. the app's full-bleed
  // pipeline tab), the `nodesInitialized` fit above runs against zero-size
  // bounds and strands the graph at ~0.12x. Watch the surface element and re-fit
  // exactly once on the 0 → real size transition. A container that is ALREADY
  // sized at mount (the standalone workspace page) seeds `hadSizeRef` true here,
  // so the observer never treats its first callback as a transition — the fit
  // stays owned by the effect above and this is a no-op there.
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const hadSizeRef = React.useRef(false);
  React.useEffect(() => {
    const el = surfaceRef.current;
    if (hasViewport || !el || typeof ResizeObserver === "undefined") return;
    const isReal = (w: number, h: number) => w > 1 && h > 1;
    const initial = el.getBoundingClientRect();
    hadSizeRef.current = isReal(initial.width, initial.height);
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const real = isReal(box.width, box.height);
      // Only act on the first zero → real transition; ignore sub-threshold
      // jitter and every later resize so we never refit on a stray pixel or
      // loop on the fit's own reflow.
      if (real && !hadSizeRef.current) {
        hadSizeRef.current = true;
        if (nodesInitialized) {
          raf = requestAnimationFrame(() => fitView(fitViewOptions));
        }
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hasViewport, nodesInitialized, fitView, fitViewOptions]);

  // Resolve the fullscreen node + its bridge from laidOut by id (the overlay
  // renders the widget under the SAME per-node bridge so params still flow).
  const fullscreenNode = React.useMemo(
    () =>
      fullscreenNodeId && !hiddenNodeIds.has(fullscreenNodeId)
        ? (laidOut.find((n) => n.id === fullscreenNodeId) ?? null)
        : null,
    [fullscreenNodeId, hiddenNodeIds, laidOut],
  );

  // The peeked node (same resolve as fullscreen). The drawer renders the host's
  // `renderNodePeek` content, or — for a generic canvas with no host renderer —
  // the node's own widget under its per-node bridge.
  const peekNode = React.useMemo(
    () =>
      peekNodeId && !hiddenNodeIds.has(peekNodeId)
        ? (laidOut.find((n) => n.id === peekNodeId) ?? null)
        : null,
    [peekNodeId, hiddenNodeIds, laidOut],
  );

  // --- Comments (json-ui-comments.md) ---------------------------------------
  // `enableComments` gates the whole overlay. ON BY DEFAULT — set
  // `enableComments: false` to opt out. The comment array binds to the
  // canvas-level `__comments` param (rides parley + URL-sync); pins anchor to
  // node boxes (flow coords) for hit-testing and node-anchored positioning.
  // `commentsDisabled` (host-driven, e.g. the Work Products view) forces the
  // whole overlay off regardless of the config's `enableComments`.
  const enableComments =
    rawProps.enableComments !== false && !host.commentsDisabled;
  const { comments, commit } = useCanvasComments(rawProps.comments);
  // Feedback mode (host-driven, app board): open comment mode and fan each
  // newly-added comment into the feedback task thread (host.onComment) so the
  // assigned agent iterates. Keyboard `C`/`Esc` still toggle on top.
  const [commentMode, setCommentMode] = React.useState(
    host.feedbackMode ?? false,
  );
  // Entering feedback mode opens comments; leaving it closes them. (Between
  // transitions the `C`/`Esc` keys still toggle freely — this only fires when
  // the host flips feedbackMode.)
  React.useEffect(() => {
    setCommentMode(host.feedbackMode ?? false);
  }, [host.feedbackMode]);
  const commitComments = React.useCallback(
    (next: Parameters<typeof commit>[0]) => {
      if (host.feedbackMode && host.onComment) {
        const prevIds = new Set(comments.map((c) => c.id));
        for (const c of next) {
          if (!prevIds.has(c.id) && c.content?.trim())
            host.onComment({
              text: c.content,
              anchorId: c.anchorId,
              anchorPath: c.anchorPath,
            });
        }
      }
      // Start the feedback loop on a feedback WRITE (a new comment, a reopen, or
      // a new reply) — but only when the host drives the loop and it isn't
      // already on. VIEWING a thread (opening a pin) does not commit, so it
      // never reaches here; edit-content / resolve / delete / drag are not writes.
      if (
        host.onRequestCommentMode &&
        !host.feedbackMode &&
        isFeedbackWrite(comments, next)
      )
        host.onRequestCommentMode(true);
      commit(next);
      // Persist the FULL array on every commit (add/edit/resolve/delete) —
      // distinct from the new-only `onComment` fan-out above.
      host.onCommentsChange?.(next);
    },
    [comments, commit, host],
  );
  // A USER gesture (the `C` key, the CanvasControls comment button, opening a
  // pin) requesting a comment-mode change. When the host drives the loop
  // (`host.onRequestCommentMode` provided) we hand it the change INSTEAD of
  // toggling locally — the host flips its feedback loop and `commentMode`
  // follows via the feedbackMode effect above. Standalone (no host callback)
  // keeps the local toggle. The downstream feedbackMode→setCommentMode sync is
  // NOT routed here (it's not a user gesture), so there is no toggle loop.
  const onRequestCommentMode = host.onRequestCommentMode;
  const requestCommentMode = React.useCallback(
    (on: boolean) => {
      if (onRequestCommentMode) onRequestCommentMode(on);
      else setCommentMode(on);
    },
    [onRequestCommentMode],
  );
  const toggleCommentMode = React.useCallback(
    () => requestCommentMode(!commentMode),
    [requestCommentMode, commentMode],
  );
  // Comment placement is driven by ReactFlow click events (below), not a
  // blocking overlay — a click (not a drag) routes to the overlay's `placeAt`,
  // so pan/zoom/scroll keep working natively in comment mode.
  const commentsRef = React.useRef<CanvasCommentsHandle>(null);
  const placeCommentFromClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (commentMode) commentsRef.current?.placeAt(e.clientX, e.clientY);
    },
    [commentMode],
  );

  // `C` toggles comment mode, `Esc` exits — ignored while typing in a field.
  React.useEffect(() => {
    if (!enableComments) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (e.key === "Escape") {
        requestCommentMode(false);
      } else if (
        (e.key === "c" || e.key === "C") &&
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        requestCommentMode(!commentMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableComments, requestCommentMode, commentMode]);

  // Node boxes in flow coords (visible nodes only) — pin anchoring + hit-test.
  const nodeBoxes = React.useMemo(() => {
    const m = new Map<string, NodeBox>();
    for (const n of laidOut) {
      if (hiddenNodeIds.has(n.id)) continue;
      const pos = n.position ?? { x: 0, y: 0 };
      const sz = sizeOf(n);
      m.set(n.id, { x: pos.x, y: pos.y, width: sz.width, height: sz.height });
    }
    return m;
  }, [laidOut, hiddenNodeIds, sizeOf]);

  return (
    // position:relative + min-height gives a definite box; the absolute child
    // fills it so ReactFlow's height:100% resolves even when an ancestor has
    // auto height (a bare height:100% would collapse).
    <div
      ref={surfaceRef}
      className="canvas-surface"
      style={CANVAS_SURFACE_STYLE}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          defaultViewport={rawProps.viewport}
          fitView={!hasViewport && fitViewOnMount}
          fitViewOptions={fitViewOptions}
          onInit={onInit}
          // In comment mode, a click on empty canvas OR on a node opens a
          // comment draft at the click point (placeAt hit-tests to anchor onto
          // a node when appropriate). These fire only on a click, not a drag,
          // so pan/zoom/scroll are unaffected.
          onPaneClick={placeCommentFromClick}
          onNodeClick={placeCommentFromClick}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          onlyRenderVisibleElements={false}
          proOptions={proOptions}
        >
          <CanvasBackground variant={rawProps.background ?? "dots"} />
          {enableComments ? (
            <CanvasCommentsOverlay
              ref={commentsRef}
              comments={comments}
              commit={commitComments}
              commentMode={commentMode}
              nodeBoxes={nodeBoxes}
              hiddenNodeIds={hiddenNodeIds}
            />
          ) : null}
          {rawProps.showControls !== false ? (
            <CanvasControls
              fitViewPadding={fitViewOptions.padding}
              showComments={enableComments}
              commentMode={commentMode}
              onToggleComments={toggleCommentMode}
            />
          ) : null}
        </ReactFlow>
        {parsed.errors.length > 0 ? (
          <CanvasConfigErrorBanner errors={parsed.errors} />
        ) : null}
      </div>
      {fullscreenNode ? (
        <CanvasFullscreenOverlay
          node={fullscreenNode}
          bridge={runtime.getNodeBridge(fullscreenNode.id)}
          onClose={closeFullscreen}
        />
      ) : null}
      {peekNode ? (
        <CanvasNodeDrawer
          // A name-only overview node has no title; fall back to its id with the
          // `type:` prefix stripped (e.g. "udf:foo" → "foo").
          title={peekNode.title || peekNode.id.replace(/^[a-z]+:/, "")}
          onClose={closePeek}
          onExpand={
            host.onNodePeekExpand
              ? () => host.onNodePeekExpand?.(peekNode)
              : () => {
                  // No host expand → promote to the fullscreen overlay.
                  setPeekNodeId(null);
                  setFullscreenNodeId(peekNode.id);
                }
          }
        >
          {host.renderNodePeek ? (
            host.renderNodePeek(peekNode)
          ) : (
            <FusedWidgetBridgeContext.Provider
              value={runtime.getNodeBridge(peekNode.id)}
            >
              <RenderNode node={peekNode.widget as UINode} />
            </FusedWidgetBridgeContext.Provider>
          )}
        </CanvasNodeDrawer>
      ) : null}
    </div>
  );
}

export function CanvasRenderer(props: ComponentRenderProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

CanvasRenderer.displayName = "CanvasRenderer";
