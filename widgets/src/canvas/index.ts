/**
 * Public surface of the JSON-UI canvas React layer.
 *
 * NOTE: `CanvasRenderer` is imported statically. The host builds as a single
 * inlined esbuild bundle (no code-splitting), so ReactFlow ships in the one
 * bundle. True lazy-loading is deferred.
 */
export { CanvasRenderer } from "./canvas-renderer";
export {
  CanvasHostContext,
  useCanvasHost,
  type CanvasHostValue,
} from "./canvas-host-context";
