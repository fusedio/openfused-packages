import { useCallback, useRef, useSyncExternalStore } from "react";

import { useFusedWidgetBridge } from "../bridge";

/**
 * Returns the set of UDF names this node may reference (computed from
 * incoming edges). Returns `null` when no filtering applies (e.g. node has
 * no identity, or running in a shared widget context).
 *
 * Use this to gate AI suggestions or SQL queries to only reference
 * connected UDFs — ensures consistency with the canvas's edge topology.
 *
 * @example
 * const allowed = useAllowedUdfNames();
 * if (allowed && !allowed.has(udfName)) {
 *   return <div>UDF "{udfName}" is not reachable from this node.</div>;
 * }
 */
export function useAllowedUdfNames(): Set<string> | null {
  const bridge = useFusedWidgetBridge();

  const subscribe = useCallback(
    (cb: () => void) => bridge.routing.subscribeAllowedSources(cb),
    [bridge],
  );

  const snapshotRef = useRef<Set<string> | null>(null);
  const getSnapshot = useCallback(() => {
    const next = bridge.routing.getAllowedUdfNames();
    const prev = snapshotRef.current;
    if (setsEqual(prev, next)) return prev;
    snapshotRef.current = next;
    return next;
  }, [bridge]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function setsEqual<T>(a: Set<T> | null, b: Set<T> | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
