import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useFusedWidgetBridge, type UdfOutputSnapshot } from "../bridge";

/**
 * Subscribe to a UDF's output by name. Returns the current `UdfOutputSnapshot`
 * (data + execution status + optional error + VFS filename) or `undefined`
 * if the UDF is not present in the canvas.
 *
 * Re-renders when the UDF's results change (after re-execution) or when its
 * execution status flips.
 *
 * @example
 * const out = useUdfOutputByName("cities_udf");
 * if (!out) return <div>UDF not found</div>;
 * if (out.isExecutionInProgress) return <div>Loading…</div>;
 * if (out.error) return <div>Error: {out.error}</div>;
 */
export function useUdfOutputByName(
  udfName: string | undefined,
): UdfOutputSnapshot | undefined {
  const bridge = useFusedWidgetBridge();

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!udfName) return () => {};
      return bridge.udfs.subscribeOutput(udfName, cb);
    },
    [bridge, udfName],
  );

  const snapshotRef = useRef<UdfOutputSnapshot | undefined>(undefined);
  const getSnapshot = useCallback(() => {
    if (!udfName) return undefined;
    const next = bridge.udfs.getOutputSnapshot(udfName);
    const prev = snapshotRef.current;
    if (snapshotsEqual(prev, next)) return prev;
    snapshotRef.current = next;
    return next;
  }, [bridge, udfName]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Request the workbench to re-execute a named UDF (e.g. after the user
 * clicks a "Refresh" button). No-op in test harnesses without re-execution.
 */
export function useRequestUdfReexecute(): (udfName: string) => void {
  const bridge = useFusedWidgetBridge();
  return useCallback(
    (udfName: string) => bridge.udfs.requestReexecute(udfName),
    [bridge],
  );
}

function snapshotsEqual(
  a: UdfOutputSnapshot | undefined,
  b: UdfOutputSnapshot | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.data === b.data &&
    a.isExecutionInProgress === b.isExecutionInProgress &&
    a.error === b.error &&
    a.vfsFilename === b.vfsFilename
  );
}

// ============================================================================
// UDF column query convenience hooks
// ============================================================================

const UDF_QUERY_REGEX = /^\{\{(\w+)\.(\w+)(?:\[(\d+)\])?\}\}$/;

export type ParsedUdfQuery = {
  udfName: string;
  columnName: string;
  index?: number;
} | null;

/**
 * Fast check whether a string is `{{udf.col}}` or `{{udf.col[idx]}}`.
 *
 * @example
 * isUdfQuery("{{my_udf.city}}")    // true
 * isUdfQuery("{{my_udf.city[0]}}") // true
 * isUdfQuery("not a query")        // false
 */
export function isUdfQuery(query?: string): boolean {
  if (!query || typeof query !== "string") return false;
  return UDF_QUERY_REGEX.test(query);
}

/**
 * Parse a UDF column query string. Returns `null` for unrecognised input.
 *
 * @example
 * parseUdfColumnQuery("{{my_udf.city}}")    // { udfName: "my_udf", columnName: "city" }
 * parseUdfColumnQuery("{{my_udf.city[0]}}") // { ..., index: 0 }
 */
export function parseUdfColumnQuery(query?: string): ParsedUdfQuery {
  if (!isUdfQuery(query)) return null;
  const match = query!.match(UDF_QUERY_REGEX);
  if (!match) return null;
  const [, udfName, columnName, indexStr] = match;
  const index = indexStr !== undefined ? parseInt(indexStr, 10) : undefined;
  return { udfName, columnName, index };
}

export interface UseUdfDataFrameSampleOptions {
  udfName?: string;
  sampleSize?: number;
}

export interface UseUdfDataFrameSampleResult {
  loading: boolean;
  errorMessage: string | null;
  isError: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  requestReexecute: () => void;
}

interface DataSourceLike {
  getRows(start: number, end: number): Promise<unknown[]>;
}

function isDataSourceLike(value: unknown): value is DataSourceLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { getRows?: unknown }).getRows === "function"
  );
}

/**
 * Pull a small sample of rows from a UDF's DataFrame output and derive
 * column names. Used by dropdowns and galleries that populate options
 * from UDF data.
 */
export function useUdfDataFrameSample({
  udfName,
  sampleSize = 200,
}: UseUdfDataFrameSampleOptions): UseUdfDataFrameSampleResult {
  const snapshot = useUdfOutputByName(udfName);
  const reexecute = useRequestUdfReexecute();

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const data = snapshot?.data;
    if (!data || !isDataSourceLike(data)) {
      setRows([]);
      setColumns([]);
      return;
    }
    (async () => {
      try {
        const rawRows = await data.getRows(0, Math.max(0, sampleSize));
        if (cancelled) return;
        const normalized: Record<string, unknown>[] = rawRows.map((r) => {
          const obj = r as { properties?: unknown } | null;
          if (
            obj &&
            typeof obj === "object" &&
            obj.properties &&
            typeof obj.properties === "object"
          ) {
            return obj.properties as Record<string, unknown>;
          }
          return r as Record<string, unknown>;
        });
        setRows(normalized);
        const cols = Array.from(
          new Set(normalized.flatMap((r) => Object.keys(r ?? {}))),
        );
        setColumns(cols);
      } catch {
        if (cancelled) return;
        setRows([]);
        setColumns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot?.data, sampleSize]);

  const requestReexecute = useCallback(() => {
    if (udfName) reexecute(udfName);
  }, [reexecute, udfName]);

  return {
    loading: snapshot?.isExecutionInProgress ?? false,
    errorMessage: snapshot?.error ?? null,
    isError: Boolean(snapshot?.error),
    columns,
    rows,
    requestReexecute,
  };
}

export interface UseUdfColumnValuesResult {
  values: unknown[];
  loading: boolean;
}

/**
 * Read all values from a UDF column using `{{udf.col}}` query syntax.
 *
 * @example
 * const { values, loading } = useUdfColumnValues("{{my_udf.city}}");
 * // values = ["NYC", "LA", "SF", ...]
 */
export function useUdfColumnValues(
  query?: string,
  sampleSize: number = 200,
): UseUdfColumnValuesResult {
  const isValid = isUdfQuery(query);
  const parsed = useMemo(
    () => (isValid ? parseUdfColumnQuery(query) : null),
    [isValid, query],
  );

  const { rows, loading } = useUdfDataFrameSample({
    udfName: parsed?.udfName,
    sampleSize,
  });

  const values = useMemo(() => {
    if (!parsed || !parsed.columnName) return [];
    return rows
      .map((row) => row?.[parsed.columnName])
      .filter((v) => v !== undefined && v !== null);
  }, [rows, parsed]);

  return { values, loading: isValid ? loading : false };
}

export interface UseUdfColumnValueResult {
  value: unknown | null;
  loading: boolean;
}

/**
 * Read a single value from a UDF column at a specific index.
 *
 * @example
 * const { value, loading } = useUdfColumnValue("{{my_udf.city[0]}}");
 * // value = "NYC"
 */
export function useUdfColumnValue(
  query?: string,
  sampleSize: number = 200,
): UseUdfColumnValueResult {
  const isValid = isUdfQuery(query);
  const parsed = useMemo(
    () => (isValid ? parseUdfColumnQuery(query) : null),
    [isValid, query],
  );

  const { rows, loading } = useUdfDataFrameSample({
    udfName: parsed?.udfName,
    sampleSize,
  });

  const value = useMemo(() => {
    if (!parsed || !parsed.columnName || parsed.index === undefined)
      return null;
    const row = rows[parsed.index];
    if (!row) return null;
    const v = row[parsed.columnName];
    return v !== undefined ? v : null;
  }, [rows, parsed]);

  return { value, loading: isValid ? loading : false };
}
