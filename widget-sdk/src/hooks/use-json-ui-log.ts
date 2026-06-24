import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import {
  useFusedWidgetBridge,
  useJsonUiNode,
  type JsonUiLogLevel,
  type LogEntry,
} from "../bridge";

const EMPTY_LOGS: readonly LogEntry[] = Object.freeze([]);

/**
 * Logging hook for json-ui components. Entries appear in the workbench's
 * runtime logs panel for the current node.
 *
 * Entries are automatically tagged with the current widget's `configHash`
 * (resolved through `JsonUiNodeOverrideContext` so nested
 * `JsonUiConfigHashOverride` subtrees emit correctly-scoped entries),
 * which lets the workbench discard stale entries when a widget's JSON is
 * edited.
 *
 * @example
 * const { log } = useJsonUiLog();
 * log("Selected city: " + city);
 * log("Failed to load chart data", "error");
 */
export function useJsonUiLog(): {
  log: (message: string, level?: JsonUiLogLevel) => void;
} {
  const bridge = useFusedWidgetBridge();
  const { configHash } = useJsonUiNode();
  // bridge and configHash are read from refs so the returned `log` callback
  // identity is stable across re-renders. Downstream effects with `log` in
  // their deps (e.g. use-duckdb-sql.ts's preprocessing effect) would
  // otherwise re-fire on every bridge flip / configHash change and cascade
  // setState across every SQL widget in the dashboard.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const configHashRef = useRef(configHash);
  configHashRef.current = configHash;
  const log = useCallback((message: string, level: JsonUiLogLevel = "info") => {
    bridgeRef.current.log.log(message, level, configHashRef.current);
  }, []);
  return useMemo(() => ({ log }), [log]);
}

/**
 * Read-only hook returning the current log entries for a given node.
 * Returns an empty array if `nodeId` is undefined or the node has no logs.
 *
 * Primarily used by the workbench's runtime logs panel — catalog components
 * rarely need to read logs they wrote, but the hook is exposed for
 * completeness (e.g. building a debug view component).
 */
export function useJsonUiLogs(nodeId: string | undefined): readonly LogEntry[] {
  const bridge = useFusedWidgetBridge();

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!nodeId) return () => {};
      return bridge.log.subscribeLogs(nodeId, cb);
    },
    [bridge, nodeId],
  );

  const snapshotRef = useRef<readonly LogEntry[]>(EMPTY_LOGS);
  const getSnapshot = useCallback(() => {
    if (!nodeId) return EMPTY_LOGS;
    const next = bridge.log.getLogsSnapshot(nodeId);
    if (next === snapshotRef.current) return snapshotRef.current;
    snapshotRef.current = next;
    return next;
  }, [bridge, nodeId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns a stable callback that clears all log entries for the given node.
 * Returns a no-op function when `nodeId` is undefined.
 */
export function useJsonUiLogClear(nodeId: string | undefined): () => void {
  const bridge = useFusedWidgetBridge();
  return useCallback(() => {
    if (!nodeId) return;
    bridge.log.clearLogs(nodeId);
  }, [bridge, nodeId]);
}
