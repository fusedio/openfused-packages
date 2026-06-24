import { useFusedWidgetBridge } from "../bridge";

/**
 * Controls the edge-animation pellet for the current canvas node.
 *
 * Call `startLoading()` when beginning async work and `stopLoading()` on
 * completion — the `true → false` transition is what fires the visual
 * pellet on connected outgoing canvas edges.
 *
 * `useFusedParam` calls these automatically around each broadcast, so use
 * this hook only when you need to animate edges for non-param async work
 * (e.g. a `fetch()` your component runs directly).
 *
 * @example
 * const { startLoading, stopLoading } = useJsonUiEdgeAnimation();
 * async function fetchData() {
 *   startLoading();
 *   try { await heavyCompute(); } finally { stopLoading(); }
 * }
 */
export function useJsonUiEdgeAnimation(): {
  startLoading: () => void;
  stopLoading: () => void;
} {
  const bridge = useFusedWidgetBridge();
  return {
    startLoading: bridge.edges.startLoading,
    stopLoading: bridge.edges.stopLoading,
  };
}
