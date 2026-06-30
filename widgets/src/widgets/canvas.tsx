// widgets/canvas.tsx — the registered `canvas` json-ui component.
//
// A free-form ReactFlow layout of widget nodes wired by edges that carry param
// dataflow (spec/ui/data/canvas.md). This file is the THIN registration shim:
// the React layer lives under `../canvas/*` (the renderer, node, edge, folder,
// chrome, runtime, and the Phase-1 pure modules). It:
//   - declares its props as `CanvasPropsSchema` (the Phase-1 Zod source of
//     truth — inert zod-stub in the render bundle, real zod under generate.ts);
//   - renders `<CanvasRenderer>` (which wraps `CanvasInner` in
//     `<ReactFlowProvider>` and reads the host data plane from
//     `CanvasHostContext`, published by main.tsx around the render tree);
//   - default-exports `{ ...defineComponent(...), writesParam: false }` like the
//     other widgets (the canvas itself never writes a param).
//
// IMPORTANT: openfused's renderer hands a widget only its `element` (the SDK
// `{type,props,children}` contract). The canvas's data plane
// (`config/data/errors/depMap/resolveUrl`) is obtained the SAME way every
// top-level widget reaches host state — from the bridge/data store built in
// main.tsx — and re-published on `CanvasHostContext` so each canvas node can
// build its per-node `WidgetDataStore` that POSTs to the SAME `resolveUrl`.

import {
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { CanvasRenderer } from "../canvas/canvas-renderer";
import { CanvasPropsSchema } from "../canvas/canvas-types";
import type { ComponentDef } from "./types";
// NOTE: the canvas stylesheet (`../canvas/canvas.css`, which also @imports
// @xyflow/react's base styles) is intentionally NOT imported here. This module
// is evaluated by the schema generator (`scripts/generate.ts`) under tsx/node,
// which cannot load `.css`. The side-effect import lives in the bundle ENTRY
// (`main.tsx`) instead — esbuild still folds it into widget.html, while the
// generator (which imports the widgets barrel, not main.tsx) never sees it.

function Canvas(props: ComponentRenderProps) {
  return <CanvasRenderer {...props} />;
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Canvas,
    props: CanvasPropsSchema,
    description:
      "A free-form canvas: each widget is a node, wired by edges that carry param dataflow. A $param set by an input in one node is only seen by a component in another node if an edge connects them. Place widgets in props.nodes[].widget (a normal json-ui config), not in a children array.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
