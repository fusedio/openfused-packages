import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { useFusedWidgetBridge } from "../bridge";

const EMPTY_RECORD: Record<string, unknown> = Object.freeze({});

/**
 * Read filtered canvas parameter values for multiple param names at once.
 *
 * The returned values are filtered by the current node's incoming edges —
 * only params broadcast by upstream-connected nodes are visible.
 *
 * Re-renders only when one of the watched params actually changes.
 *
 * @example
 * const { city, year } = useCanvasParams(["city", "year"]);
 * if (city) console.log("city is", city);
 */
export function useCanvasParams(paramNames: string[]): Record<string, unknown> {
  const bridge = useFusedWidgetBridge();
  const stableNames = useStableStringArray(paramNames);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (stableNames.length === 0) return () => {};
      return bridge.params.subscribeMany(stableNames, cb);
    },
    [bridge, stableNames],
  );

  const snapshotRef = useRef<Record<string, unknown>>(EMPTY_RECORD);
  const getSnapshot = useCallback(() => {
    if (stableNames.length === 0) return EMPTY_RECORD;
    const next = bridge.params.getSnapshotMany(stableNames);
    const prev = snapshotRef.current;
    if (shallowEqualRecords(prev, next)) return prev;
    snapshotRef.current = next;
    return next;
  }, [bridge, stableNames]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function shallowEqualRecords(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function useStableStringArray(names: readonly string[]): readonly string[] {
  const ref = useRef<readonly string[]>(names);
  const prev = ref.current;
  if (
    prev !== names &&
    (prev.length !== names.length || prev.some((n, i) => n !== names[i]))
  ) {
    ref.current = names;
  }
  return ref.current;
}
