import { useCallback, useRef, useSyncExternalStore } from "react";

import { useFusedWidgetBridge, type AllowedSource } from "../bridge";

/**
 * Returns the set of UDFs allowed to broadcast params to the current node,
 * computed from canvas edges.
 *
 * Returns `{ allowedSources: null }` when no filtering is applied — typically
 * because the node has no identity or runs in a shared/embed context where
 * topology isn't available.
 *
 * The companion `isAllowedSource(originUdfId, originUdfName)` helper checks
 * whether a specific source identity is permitted.
 *
 * @example
 * const { allowedSources, isAllowedSource } = useAllowedSources();
 * console.log("allowed:", allowedSources?.map(s => s.udfName));
 */
export function useAllowedSources(): {
  allowedSources: ReadonlyArray<AllowedSource> | null;
  isAllowedSource: (originUdfId?: string, originUdfName?: string) => boolean;
} {
  const bridge = useFusedWidgetBridge();

  const subscribe = useCallback(
    (cb: () => void) => bridge.routing.subscribeAllowedSources(cb),
    [bridge],
  );

  const snapshotRef = useRef<ReadonlyArray<AllowedSource> | null>(null);
  const getSnapshot = useCallback(() => {
    const next = bridge.routing.getAllowedSources();
    const prev = snapshotRef.current;
    if (allowedSourcesEqual(prev, next)) return prev;
    snapshotRef.current = next;
    return next;
  }, [bridge]);

  const allowedSources = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const isAllowedSource = useCallback(
    (originUdfId?: string, originUdfName?: string) => {
      if (!allowedSources || allowedSources.length === 0) return true;
      if (!originUdfId && !originUdfName) return true;
      return allowedSources.some(
        (s) =>
          (s.udfUniqueId && s.udfUniqueId === originUdfId) ||
          (s.udfName && s.udfName === originUdfName),
      );
    },
    [allowedSources],
  );

  return { allowedSources, isAllowedSource };
}

function allowedSourcesEqual(
  a: ReadonlyArray<AllowedSource> | null,
  b: ReadonlyArray<AllowedSource> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (src, i) =>
      src.udfUniqueId === b[i].udfUniqueId && src.udfName === b[i].udfName,
  );
}
