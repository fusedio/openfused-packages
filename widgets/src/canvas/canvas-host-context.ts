/**
 * Threads the host's data-resolution inputs from the canvas widget down to the
 * canvas nodes. openfused-local — depends on NO app paths.
 *
 * The app's mcp-host threaded `{registry, config, data, errors, depMap,
 * resolveUrl}` via `CanvasHostContext` because its registry components only
 * received `element` and had no other way to reach the host. openfused differs
 * in two ways:
 *   1. There is no registry to thread — `canvas-node` renders `node.widget`
 *      through openfused's own recursive renderer (`RenderNode` from
 *      `../render`), which resolves the registry internally. So `registry` is
 *      dropped from this context.
 *   2. `config`/`data`/`errors`/`depMap`/`resolveUrl` are obtained the SAME way
 *      top-level widgets do — the canvas widget (`widgets/canvas.tsx`) reads them
 *      off the `element.props._canvasHost` envelope the renderer threads in (see
 *      that file), which originates from the structuredContent payload in
 *      `main.tsx`. The canvas builds per-node `WidgetDataStore`s from them, each
 *      POSTing to the same `resolveUrl` (`canvas-data.ts`).
 *
 * This minimal context only carries those data-plane fields from `canvas.tsx`
 * down to `canvas-node` so each node can build its per-node store. It is the
 * cleanest seam: the renderer's `<Component element={...} />` contract gives a
 * widget only its `element`, so the canvas re-publishes the host data plane on a
 * context its own nodes read.
 */
import { createContext, useContext } from "react";

import type { DepMap } from "../data-store";
import type { WidgetData, WidgetErrors } from "../static-bridge";

export interface CanvasHostValue {
  /** The full canvas config (POSTed back so the resolver re-stamps the same qids). */
  config: unknown;
  data?: WidgetData;
  errors?: WidgetErrors;
  depMap?: DepMap;
  /** The widget-data POST endpoint openfused already uses (main.tsx). */
  resolveUrl?: string;
  /** Opt-in (pipeline overview): the canvas's first data resolve is still in
   * flight, so every data-bound node renders a loading spinner (+ elapsed timer)
   * until its data arrives. Other surfaces leave it unset → no spinner (unchanged). */
  dataLoading?: boolean;
  /** Opt-in (Overview canvas): hide every node's fullscreen/maximize button — a
   * name-only overview node has nothing to maximize. Unset elsewhere (button shows). */
  disableNodeFullscreen?: boolean;
  /** Feedback mode (app board): force comment mode on so the canvas is a quick
   * iterative-feedback surface. Set by the host when a feedback loop is active. */
  feedbackMode?: boolean;
  /** Called for each newly-added comment while `feedbackMode` is on, so the host
   * can fan it into the feedback task's thread (waking the agent). Carries the
   * comment's anchor (`anchorId` for a canvas node, `anchorPath` for a widget
   * node) so the host can name the target widget — without it, "make this red"
   * reaches the agent with no indication of WHICH widget it's about. */
  onComment?: (c: { text: string; anchorId?: string; anchorPath?: string }) => void;
  /** Called with the FULL comments array on EVERY commit (add/edit/resolve/
   * delete) — distinct from `onComment` (new-only). The host debounces it to
   * persist comments back into the widget config JSON. */
  onCommentsChange?: (comments: import("./canvas-types").CanvasComment[]) => void;
  /** Host-driven comment-mode toggle: when provided, USER gestures that would
   * toggle comment mode (the `C` key, the CanvasControls comment button, opening
   * a pin) call THIS instead of the renderer's local `setCommentMode` — so the
   * app's feedback loop owns the on/off (entering creates the task, leaving
   * sends the batch). `commentMode` itself stays driven by `feedbackMode` via the
   * renderer's effect, so it follows once the host flips feedback. Absent in the
   * standalone MCP bundle (main.tsx), where local toggling is kept. */
  onRequestCommentMode?: (on: boolean) => void;
  /** When true, the host suppresses the comment overlay entirely (e.g. the Work
   * Products view): the canvas renderer forces its `enableComments` to false. */
  commentsDisabled?: boolean;
  /** Host-supplied content for the node peek-drawer (config `nodePeek`). Given the
   * clicked node, return the read-only artifact to render in the drawer body. The
   * pipeline canvas supplies this (it fetches the artifact by stem). When absent,
   * the drawer falls back to the node's own widget (`<RenderNode node.widget/>`)
   * so a generic `nodePeek` canvas peeks its node body for free. */
  renderNodePeek?: (
    node: import("./canvas-types").CanvasNode,
  ) => import("react").ReactNode;
  /** The peek-drawer's expand (`⤢`) action: the host navigates to the artifact's
   * full route. When absent, `⤢` promotes the node to the fullscreen overlay. */
  onNodePeekExpand?: (node: import("./canvas-types").CanvasNode) => void;
}

export const CanvasHostContext = createContext<CanvasHostValue | null>(null);

export function useCanvasHost(): CanvasHostValue {
  const value = useContext(CanvasHostContext);
  if (!value) {
    throw new Error(
      "useCanvasHost must be used within a CanvasHostContext.Provider (wired in widgets/canvas.tsx).",
    );
  }
  return value;
}
