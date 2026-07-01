// Canvas data model for the JSON-UI `type: "canvas"` component.
// Mirrors the canvas-model contract — the single source of truth for shapes.
//
// `CanvasPropsSchema` (Zod) is the BUILD-TIME source of truth: the config TS types below are
// derived from it via `z.input` (so `.default()` fields stay optional, matching authored config).
// In the render bundle `zod` is aliased to a no-op stub (build.mjs), so this schema adds ZERO
// runtime weight; `z.input` is type-only. The `generate` path uses real zod for the agent catalog.
import { z } from "zod";

/** A JSON-UI widget config subtree: { type, props?, children? }. Compiled per node. */
export type JsonUiNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: JsonUiNode[];
};

/** JSON-Schema view of a node's widget subtree (the emitted shape; the exported CanvasNode keeps the recursive JsonUiNode). */
const JsonUiNodeSchema = z
  .object({
    type: z
      .string()
      .describe(
        'The json-ui component type of this widget (e.g. "metric", "slider", "bar-chart", "div").',
      ),
    props: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "The widget's props. Call get_component_schema with this widget's type for the exact prop schema.",
      ),
    children: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        "Child widget configs, only for container widgets like div/form. Each child is itself a { type, props, children } config.",
      ),
  })
  .describe(
    "A nested json-ui widget config of the form { type, props, children }. May be any supported component, including a div with its own children subtree. Call get_component_schema for the inner widget's exact props.",
  );

export const ViewportSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    zoom: z.number(),
  })
  .describe(
    "Initial pan/zoom of the canvas. Optional: if absent, the canvas fits all nodes into view on load.",
  );
export type Viewport = z.input<typeof ViewportSchema>;

export const CanvasNodeSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable, author-defined identifier, unique across the canvas. Used as the routing key for edges and as the React key.",
    ),
  widget: JsonUiNodeSchema,
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .describe(
      "Pixel position of the node's top-left corner on the canvas. Optional: if absent, auto-layout assigns one. Prefer omitting position so the canvas auto-arranges nodes left-to-right (Data→Transform→View); set layer instead of position to hint the column.",
    ),
  size: z
    .object({ width: z.number(), height: z.number() })
    .optional()
    .describe(
      "Pixel size of the node's box. Optional — PREFER OMITTING it. By default the canvas content-sizes each node to fit its widget (charts and maps get a sensible default size; controls, metrics, and text size to their content), which gives the best-looking layout. Only set width/height when you specifically need a non-default size (e.g. a deliberately large map). A small or guessed size will clip or cramp the widget, so do not set it just to be safe — omit it and let the canvas size the node.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "Optional node chrome label shown above the widget. Use sentence case.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Optional one-line description of what this node shows. Surfaced on hover (with the title); use it to explain a chart/metric the title alone doesn't make obvious. Sentence case.",
    ),
  layer: z
    .enum(["data", "transform", "view"])
    .optional()
    .describe(
      "Optional DTV column hint for auto-layout: data (sources, left), transform (middle), view (outputs, right). Prefer omitting position and setting layer so the canvas auto-arranges left-to-right; only set explicit position when you need an exact placement.",
    ),
  peek: JsonUiNodeSchema.optional().describe(
    "Optional richer body rendered in the node peek-drawer (canvas config `nodePeek`) INSTEAD of `widget`. Lets a node display compactly (e.g. a name card) yet peek a fuller artifact (the reference note, the UDF source, the widget) without navigating away. When omitted the drawer falls back to `widget`.",
  ),
});
/** Keep `widget`/`peek` as the recursive JsonUiNode the renderer expects (the schema view above is flat). */
export type CanvasNode = Omit<z.input<typeof CanvasNodeSchema>, "widget" | "peek"> & {
  widget: JsonUiNode;
  peek?: JsonUiNode;
};

export const CanvasEdgeSchema = z.object({
  source: z.string().describe("The id of the node the edge starts from."),
  target: z.string().describe("The id of the node the edge points to."),
  id: z
    .string()
    .optional()
    .describe('Optional edge id. Derived as "${source}->${target}" if absent.'),
  directional: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), dataflow goes source -> target only. If false, the edge is bidirectional and carries dataflow both ways.",
    ),
});
export type CanvasEdge = z.input<typeof CanvasEdgeSchema>;

export const CanvasFolderSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable identifier, unique among folders AND distinct from every node id (folders and nodes share one id space).",
    ),
  nodeIds: z
    .array(z.string())
    .describe(
      "Ids of the nodes this folder groups. A node belongs to at most one folder. Folders are organizational only — they never affect dataflow.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "Optional region label shown at the folder's top-left. Use sentence case.",
    ),
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .describe(
      "Pixel position of the folder's top-left. Optional: if absent, the region is derived to bound its members. Prefer omitting it.",
    ),
  size: z
    .object({ width: z.number(), height: z.number() })
    .optional()
    .describe(
      "Pixel size of the folder region. Optional: if absent, derived from the members' bounding box plus padding.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Optional region tint key (a chart hue, e.g. "chart-4") to differentiate folders. Purely decorative — not the selection/flow accent.',
    ),
  collapsed: z
    .boolean()
    .optional()
    .describe(
      "If true, the folder renders as a summary bar and its member nodes are hidden. Default expanded.",
    ),
});
export type CanvasFolder = z.input<typeof CanvasFolderSchema>;

// --- Comments (json-ui-comments.md) -----------------------------------------
// A comment thread is canvas-level data carried on the reserved `__comments`
// param. The schemas below are the seed shape (props.comments) and are also what
// `get_component_schema("canvas")` teaches the agent, so it knows the exact shape
// to read off the parley `params` snapshot and to bake back into props.comments
// when it resolves a thread.

/** Who authored a comment or reply. */
export type CommentAuthor = "human" | "agent";
/** A thread's work-queue status. "in_progress" = the agent is actively working
 * on it (drives the live AI status bar). */
export type CommentStatus = "open" | "in_progress" | "resolved";

export const CommentReplySchema = z.object({
  id: z.string().describe("Stable, unique reply id."),
  content: z.string().describe("The reply text."),
  author: z
    .enum(["human", "agent"])
    .describe('Who wrote the reply: "human" (the reviewer) or "agent".'),
  createdAt: z
    .number()
    .describe("Epoch milliseconds when the reply was created."),
});
export type CommentReply = z.input<typeof CommentReplySchema>;

export const CanvasCommentSchema = z.object({
  id: z.string().describe("Stable, unique comment id within the canvas."),
  content: z.string().describe("The thread's root message."),
  author: z
    .enum(["human", "agent"])
    .describe('Who opened the thread: "human" (the reviewer) or "agent".'),
  status: z
    .enum(["open", "in_progress", "resolved"])
    .optional()
    .default("open")
    .describe(
      'Work-queue status. "open" (default) = needs attention; "in_progress" = the agent is actively working on it (shows in the live AI status bar); "resolved" = done. The agent treats open threads as its queue.',
    ),
  replies: z
    .array(CommentReplySchema)
    .optional()
    .default([])
    .describe("Chronological replies. Empty by default."),
  createdAt: z
    .number()
    .describe("Epoch milliseconds when the thread was opened."),
  updatedAt: z
    .number()
    .optional()
    .describe("Epoch milliseconds of the last mutation."),
  anchorId: z
    .string()
    .optional()
    .describe(
      "The id of the canvas node this comment is pinned to (props.nodes[].id). The scope pointer: which node/UDF the comment is about. Omit for a canvas-anchored (free-floating) comment.",
    ),
  anchorPath: z
    .string()
    .optional()
    .describe(
      'For a comment on a NON-canvas widget (json-ui-comments.md §9): the stable pre-order path of the widget node it pins to (e.g. "0.2.1"). The page-level overlay resolves it to that node\'s on-screen box. Mutually exclusive with anchorId.',
    ),
  offsetX: z
    .number()
    .optional()
    .describe("Pixel offset of the pin from the anchored node's top-left (x)."),
  offsetY: z
    .number()
    .optional()
    .describe("Pixel offset of the pin from the anchored node's top-left (y)."),
  x: z
    .number()
    .optional()
    .describe(
      "Canvas (flow) x coordinate — the fallback position when unanchored.",
    ),
  y: z
    .number()
    .optional()
    .describe(
      "Canvas (flow) y coordinate — the fallback position when unanchored.",
    ),
  resolvedBy: z
    .enum(["human", "agent"])
    .optional()
    .describe("Who resolved the thread (set when status is resolved)."),
  resolvedAt: z
    .number()
    .optional()
    .describe("Epoch milliseconds when the thread was resolved."),
});
export type CanvasComment = z.input<typeof CanvasCommentSchema>;

/** The reserved, canvas-level param name comment threads are carried on. */
export const COMMENTS_PARAM = "__comments";

export const CanvasPropsSchema = z
  .object({
    nodes: z
      .array(CanvasNodeSchema)
      .describe(
        "The widgets placed on the canvas. Each node holds one json-ui widget config (NOT a children array). Content goes here, not in a children array.",
      ),
    comments: z
      .array(CanvasCommentSchema)
      .optional()
      .describe(
        "Pinned comment threads (json-ui-comments.md). Seeds the canvas-level __comments param. A reviewer adds these in the UI; an agent reads open threads off the parley and, when resolving, bakes the full updated array back here on its next push.",
      ),
    enableComments: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether the canvas shows the comment-mode toggle and renders comment pins/threads. Default true; set false to hide comments.",
      ),
    edges: z
      .array(CanvasEdgeSchema)
      .optional()
      .describe(
        "Connections between nodes that carry param dataflow. A value set in the source node reaches the target node along the edge (incoming edges feed; outgoing bidirectional edges also feed). Optional: defaults to no edges.",
      ),
    viewport: ViewportSchema.optional(),
    folders: z
      .array(CanvasFolderSchema)
      .optional()
      .describe(
        'Optional titled regions that visually group nodes ("sections"). Organizational only: a folder never changes which params a node sees — dataflow is gated by edges alone. Omit folder positions/sizes by default; the region is derived to bound its members.',
      ),
    folderBands: z
      .enum(["vertical", "horizontal"])
      .optional()
      .default("vertical")
      .describe(
        'How position-less (derived) folder regions are arranged. "vertical" (default) stacks them top→bottom; "horizontal" lays them out side-by-side left→right (matching the data→transform→view flow). Only affects folders WITHOUT an authored position/size — authored folders keep their absolute coordinates either way.',
      ),
    layout: z
      .enum(["dtv", "dag"])
      .optional()
      .default("dtv")
      .describe(
        'The auto-layout algorithm for position-less nodes. "dtv" (default) places nodes into layered Data→Transform→View columns. "dag" runs a dagre directed-graph layout (left→right, rankdir LR) driven by the real edges — best for a dependency graph with many cross-folder edges, which then reads as a clean DAG with even spacing instead of clustered per-folder stacks. Authored-position nodes keep their coordinates under either mode.',
      ),
    showControls: z
      .boolean()
      .optional()
      .default(true)
      .describe("Show the zoom / fit-view controls."),
    background: z
      .enum(["dots", "lines", "none"])
      .optional()
      .default("dots")
      .describe("Canvas background pattern."),
    nodePeek: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, clicking a node opens a read-only side drawer peeking that node's artifact (instead of the node's default link navigation). Default false; the project pipeline canvas turns it on. The host (app) supplies the drawer's content via CanvasHostValue.renderNodePeek; without a host renderer the drawer falls back to the node's own widget.",
      ),
    fitViewPadding: z
      .number()
      .optional()
      .default(0.1)
      .describe("Padding used when fitting all nodes into view on load."),
    // --- Edit-controls (Pass 1: present + validated; behaviour is Pass 2). ---
    editable: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Master switch — when false (default) the canvas is read-only (view mode); when true the end user can edit, subject to the per-capability flags below.",
      ),
    allowMoveNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe("When editable, drag nodes to reposition them."),
    allowResizeNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe("When editable, resize nodes."),
    allowConnectNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe("When editable, draw dataflow edges between nodes."),
    allowAddNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe("When editable, add new widget nodes from the palette."),
    allowDeleteNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe("When editable, delete nodes (and their incident edges)."),
  })
  .describe(
    "A free-form canvas. Each widget is a node wired by edges that carry param dataflow: a $param set by an input in one node is only seen by a component in another node if an edge connects them. Place widgets in props.nodes[].widget (a normal json-ui config), NOT in a children array. Omit node positions AND sizes by default — the canvas auto-arranges nodes left-to-right by dataflow and content-sizes each one to fit its widget. Only set an explicit position or size when you genuinely need a specific placement or dimension; guessing sizes makes nodes too small or cramped. For dropdown widgets on a canvas, prefer non-searchable dropdowns so their menu is fully visible.",
  );
/** Keep `nodes` as the recursive-widget CanvasNode (the schema view's node is flat). */
export type CanvasProps = Omit<z.input<typeof CanvasPropsSchema>, "nodes"> & {
  nodes: CanvasNode[];
};

// Source-tagged param entry, keyed strictly by originId (= node id) per contract §3.
// Inlined here (the app copied it from its Jotai studio-state) so this module pulls no app deps.
export interface ParamOriginEntry {
  value: unknown;
  originId: string;
  originName: string;
  updatedAt: number;
}

export type CanvasParamState = {
  [paramName: string]: { [originId: string]: ParamOriginEntry };
};
