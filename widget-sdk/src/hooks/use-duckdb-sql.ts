/**
 * DuckDB SQL execution against UDF Parquet outputs.
 *
 * Two hooks layered together:
 *   - `useDuckDbSqlQueryPreprocessing` parses placeholders, subscribes to
 *     `$param` / form values, calls the bridge to register UDFs in DuckDB
 *     VFS, signs any `s3://`/`gs://`/`fd://` URL literals, and returns the
 *     final ready-to-run SQL string.
 *   - `useDuckDbSqlQuery` consumes that processed SQL, runs it via the
 *     bridge, and surfaces `{ rows, columns, loading, error, refetch }`.
 *
 * All state-storage details (Jotai atoms, DuckDB wasm, fetcher) live on
 * the host side via the bridge. Both hooks work identically in the
 * workbench, the catalog-template test harness, or any other host.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFusedWidgetBridge, type VfsResolveRef } from "../bridge";
import { useFormParams } from "../form";
import { useJsonUiBinding } from "./json-ui-binding";
import { useJsonUiLog } from "./use-json-ui-log";
import { useJsonUiEdgeAnimation } from "./use-json-ui-edge-animation";
import { useCanvasParams } from "./use-canvas-params";
import { useSqlSourceOverrides } from "./sql-source-overrides";
import {
  computePlaceholderKey,
  extractSignableUrls,
  extractSqlParams,
  parseSqlUdfPlaceholders,
  resolveOverrideValue,
  rewriteSignedUrls,
  substituteSqlParams,
  getDollarRefName,
  type SqlUdfPlaceholder,
} from "../utils/sql-placeholders";

const DEFAULT_MAX_ROWS = 500;
const EMPTY_ROWS: ReadonlyArray<Record<string, unknown>> = Object.freeze([]);
const EMPTY_COLUMNS: readonly string[] = Object.freeze([]);

export interface UseDuckDbSqlQueryOptions {
  /**
   * SQL query with `{{udf_name}}` and `$param_name` placeholders.
   * Example: `"SELECT DISTINCT city FROM {{my_udf}} ORDER BY city"`
   */
  sql?: string;
  /** When false, skip preprocessing and execution. */
  enabled?: boolean;
  /**
   * Safety LIMIT appended if the SQL doesn't include one. Defaults to 500;
   * map widgets pass 100_000.
   */
  maxRows?: number;
  /**
   * Workbench-only: override `{{name}}` placeholders with in-memory
   * relations (DuckDB tabs in sql-runner/code-editor). When `relationName`
   * is provided, the placeholder is replaced with `"<relationName>"` rather
   * than the VFS filename. Other hosts pass `undefined`.
   */
  sourceOverrides?: Record<
    string,
    { relationName: string; error?: string; loading?: boolean }
  >;
  /** @deprecated Use `maxRows` — kept temporarily for the SDK's existing surface. */
  defaultLimit?: number;
  /**
   * Binding identity for server-resolved data (MCP-host seam). When omitted,
   * the hook falls back to `useJsonUiBinding()`. Threaded into
   * `bridge.sql.query(sql, { queryId })`; the workbench bridge ignores it.
   */
  queryId?: string;
}

export interface UseDuckDbSqlQueryResult {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns: readonly string[];
  loading: boolean;
  /** Legacy: components expect `error: string | null`. */
  error: string | null;
  refetch: () => void;
}

export interface UseDuckDbSqlQueryPreprocessingResult {
  processedSql: string;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function appendLimitIfMissing(sql: string, maxRows: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  const trimmed = sql.trimEnd();
  const withoutTrailingSemicolon = trimmed.endsWith(";")
    ? trimmed.slice(0, -1)
    : trimmed;
  return `${withoutTrailingSemicolon} LIMIT ${maxRows}`;
}

function escapeSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

interface ResolvedPlaceholder {
  raw: SqlUdfPlaceholder;
  /** Registry key used by the bridge (`computePlaceholderKey(name, resolvedOverrides)`). */
  key: string;
  /** Final string overrides; `null` for base placeholders. */
  resolvedOverrides: Record<string, string> | null;
  /** True when an override value references a `$param` that hasn't resolved yet. */
  unresolved: boolean;
}

function buildProcessedSql(
  sql: string,
  resolved: ResolvedPlaceholder[],
  fileNameMap: Map<string, string>,
  sourceOverrides: Record<string, { relationName: string }> | undefined,
  sqlParamValues: Record<string, unknown>,
  maxRows: number,
): string {
  // When the entire sql prop is a single $param (e.g. "$sql_query"),
  // use the raw param value directly — it's already a complete SQL string.
  const singleParam = sql.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (singleParam) {
    const val = sqlParamValues[singleParam[1]];
    return val == null ? "" : appendLimitIfMissing(String(val), maxRows);
  }

  // Walk right-to-left so earlier offsets stay valid as we splice.
  let processedSql = sql;
  for (let i = resolved.length - 1; i >= 0; i--) {
    const { raw, key, resolvedOverrides } = resolved[i];
    const isBase = resolvedOverrides === null;
    const sourceOverride =
      isBase && sourceOverrides ? sourceOverrides[raw.name] : undefined;
    let replacement: string;
    if (sourceOverride) {
      replacement = escapeSqlIdentifier(sourceOverride.relationName);
    } else {
      const fileName = fileNameMap.get(key) ?? `${raw.name}.parquet`;
      replacement = `'${fileName}'`;
    }
    processedSql =
      processedSql.slice(0, raw.start) +
      replacement +
      processedSql.slice(raw.end);
  }

  processedSql = appendLimitIfMissing(processedSql, maxRows);
  return substituteSqlParams(processedSql, sqlParamValues);
}

/**
 * Preprocess SQL: resolve placeholders, register UDFs via the bridge,
 * substitute params, sign URLs, append LIMIT. Returns the prepared SQL.
 */
export function useDuckDbSqlQueryPreprocessing({
  sql,
  enabled = true,
  maxRows = DEFAULT_MAX_ROWS,
  sourceOverrides: explicitSourceOverrides,
}: UseDuckDbSqlQueryOptions): UseDuckDbSqlQueryPreprocessingResult {
  const bridge = useFusedWidgetBridge();

  // Auto-detect host-provided source overrides (e.g. the workbench's
  // sql-runner exposes in-memory relations to descendants) and merge them with
  // any explicit option. Explicit overrides win on key collision. Component
  // authors never thread this manually.
  const contextSourceOverrides = useSqlSourceOverrides();
  const sourceOverrides = useMemo(() => {
    const hasContext = Object.keys(contextSourceOverrides).length > 0;
    if (!explicitSourceOverrides) {
      return hasContext ? contextSourceOverrides : undefined;
    }
    if (!hasContext) return explicitSourceOverrides;
    return { ...contextSourceOverrides, ...explicitSourceOverrides };
  }, [contextSourceOverrides, explicitSourceOverrides]);
  const { startLoading: startEdgeLoading, stopLoading: stopEdgeLoading } =
    useJsonUiEdgeAnimation();
  const { log } = useJsonUiLog();

  const [processedSql, setProcessedSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const sourcePlaceholders = useMemo<SqlUdfPlaceholder[]>(() => {
    if (!sql) return [];
    return parseSqlUdfPlaceholders(sql);
  }, [sql]);

  // Skip placeholders that have a sourceOverride active (workbench-only path).
  const placeholdersAfterOverride = useMemo(() => {
    if (!sourceOverrides) return sourcePlaceholders;
    return sourcePlaceholders.filter(
      (p) => p.overrides !== null || !sourceOverrides[p.name],
    );
  }, [sourcePlaceholders, sourceOverrides]);

  // Override values may reference $params — collect those names so we can
  // subscribe to the same canvas/form param map the SQL body uses.
  const overrideParamNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of placeholdersAfterOverride) {
      if (!p.overrides) continue;
      for (const v of Object.values(p.overrides)) {
        const name = getDollarRefName(v);
        if (name) set.add(name);
      }
    }
    return Array.from(set);
  }, [placeholdersAfterOverride]);

  const sqlParamNames = useMemo(() => {
    if (!sql) return [];
    return extractSqlParams(sql);
  }, [sql]);

  // Subscribe to canvas + form params for both the SQL body and override refs.
  const allParamNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of sqlParamNames) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    for (const n of overrideParamNames) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }, [sqlParamNames, overrideParamNames]);

  const canvasParamValues = useCanvasParams(allParamNames);
  const { inForm, values: formParamValues } = useFormParams(allParamNames);
  const sqlParamValues = useMemo(
    () =>
      inForm ? { ...canvasParamValues, ...formParamValues } : canvasParamValues,
    [inForm, canvasParamValues, formParamValues],
  );

  const resolvedPlaceholders = useMemo<ResolvedPlaceholder[]>(() => {
    return placeholdersAfterOverride.map((p) => {
      if (!p.overrides) {
        return {
          raw: p,
          key: p.name,
          resolvedOverrides: null,
          unresolved: false,
        };
      }
      const resolvedOverrides: Record<string, string> = {};
      let unresolved = false;
      for (const [paramKey, rawValue] of Object.entries(p.overrides)) {
        const r = resolveOverrideValue(rawValue, sqlParamValues);
        if (r.unresolved) unresolved = true;
        resolvedOverrides[paramKey] = r.value;
      }
      return {
        raw: p,
        key: computePlaceholderKey(p.name, resolvedOverrides),
        resolvedOverrides,
        unresolved,
      };
    });
  }, [placeholdersAfterOverride, sqlParamValues]);

  // Deduplicate refs we need to pass to the bridge for VFS registration.
  const vfsRefs = useMemo<VfsResolveRef[]>(() => {
    const seen = new Set<string>();
    const out: VfsResolveRef[] = [];
    for (const rp of resolvedPlaceholders) {
      if (rp.unresolved) continue;
      if (seen.has(rp.key)) continue;
      seen.add(rp.key);
      out.push({
        name: rp.raw.name,
        key: rp.key,
        overrides: rp.resolvedOverrides ?? undefined,
      });
    }
    return out;
  }, [resolvedPlaceholders]);

  // Stable key for the refs list — avoids re-running the resolve effect when
  // the underlying refs are structurally identical.
  const refsKey = useMemo(() => {
    return vfsRefs
      .map(
        (r) =>
          `${r.key}|${r.name}|${
            r.overrides
              ? Object.entries(r.overrides)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => `${k}=${v}`)
                  .join(",")
              : ""
          }`,
      )
      .join("\n");
  }, [vfsRefs]);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  // Subscribe to UDF output changes for every referenced UDF — `resolveVfsFilenames`
  // doesn't auto-rerun when a UDF re-executes, so we trigger a refetch.
  useEffect(() => {
    if (!enabled || vfsRefs.length === 0) return;
    const unsubs = vfsRefs.map((ref) =>
      bridge.udfs.subscribeOutput(ref.name, () => {
        setFetchKey((k) => k + 1);
      }),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [bridge, enabled, vfsRefs]);

  // Edge animation mirrors loading.
  useEffect(() => {
    if (loading) startEdgeLoading();
    else stopEdgeLoading();
  }, [loading, startEdgeLoading, stopEdgeLoading]);

  // Watch for sourceOverride errors / loading so the preprocessing reflects them.
  const sourceOverrideError = useMemo(() => {
    if (!sourceOverrides) return null;
    for (const p of sourcePlaceholders) {
      if (p.overrides !== null) continue;
      const src = sourceOverrides[p.name];
      if (src?.error) return src.error;
    }
    return null;
  }, [sourcePlaceholders, sourceOverrides]);

  const sourceOverrideLoading = useMemo(() => {
    if (!sourceOverrides) return false;
    return sourcePlaceholders.some(
      (p) => p.overrides === null && sourceOverrides[p.name]?.loading,
    );
  }, [sourcePlaceholders, sourceOverrides]);

  const hasUnresolvedOverride = resolvedPlaceholders.some(
    (rp) => rp.unresolved,
  );

  useEffect(() => {
    if (!enabled || !sql) {
      setProcessedSql("");
      setLoading(false);
      setError(null);
      return;
    }

    if (sourceOverrideError) {
      setProcessedSql("");
      setError(sourceOverrideError);
      setLoading(false);
      log(`SQL preprocessing: ${sourceOverrideError}`, "error");
      return;
    }

    if (sourceOverrideLoading || hasUnresolvedOverride) {
      setProcessedSql("");
      setError(null);
      setLoading(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      let fileNameMap = new Map<string, string>();
      let registrationErrorMap: Map<string, string> | undefined;
      if (vfsRefs.length > 0) {
        try {
          const result = await bridge.sql.resolveVfsFilenames(vfsRefs);
          if (cancelled) return;
          if (result instanceof Map) {
            // Legacy shape — names → filenames. Build a key-keyed map.
            for (const rp of resolvedPlaceholders) {
              if (rp.resolvedOverrides) continue; // legacy hosts can't handle overrides
              const fn = result.get(rp.raw.name);
              if (fn) fileNameMap.set(rp.key, fn);
            }
          } else {
            fileNameMap = result.filenames;
            registrationErrorMap = result.errors;
          }
        } catch (e: unknown) {
          if (cancelled) return;
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "VFS registration failed";
          setProcessedSql("");
          setError(msg);
          setLoading(false);
          log(`SQL preprocessing: ${msg}`, "error");
          return;
        }
      }

      // Surface any per-key registration error.
      if (registrationErrorMap) {
        for (const rp of resolvedPlaceholders) {
          const err = registrationErrorMap.get(rp.key);
          if (err) {
            if (cancelled) return;
            setProcessedSql("");
            setError(err);
            setLoading(false);
            log(`SQL preprocessing: ${err}`, "error");
            return;
          }
        }
      }

      // Every non-unresolved placeholder should now have a filename (or use a sourceOverride).
      for (const rp of resolvedPlaceholders) {
        if (rp.unresolved) continue;
        const isBase = rp.resolvedOverrides === null;
        const hasSourceOverride =
          isBase && sourceOverrides?.[rp.raw.name] !== undefined;
        if (hasSourceOverride) continue;
        if (!fileNameMap.has(rp.key)) {
          if (cancelled) return;
          // Bridge didn't return a filename; treat as still loading.
          setProcessedSql("");
          setError(null);
          setLoading(true);
          return;
        }
      }

      let nextProcessedSql: string;
      try {
        nextProcessedSql = buildProcessedSql(
          sql,
          resolvedPlaceholders,
          fileNameMap,
          sourceOverrides,
          sqlParamValues,
          maxRows,
        );
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "SQL preprocessing failed";
        setProcessedSql("");
        setError(msg);
        setLoading(false);
        log(`SQL preprocessing failed: ${msg}`, "error");
        return;
      }

      const urls = extractSignableUrls(nextProcessedSql);
      if (urls.length === 0) {
        if (cancelled) return;
        setProcessedSql(nextProcessedSql);
        setError(null);
        setLoading(false);
        log("SQL preprocessing completed");
        return;
      }

      try {
        const signedMap: Record<string, string> = {};
        const signed = await Promise.all(urls.map((u) => bridge.signUrl(u)));
        if (cancelled) return;
        urls.forEach((u, i) => {
          signedMap[u] = signed[i].signed;
        });
        const signedSql = rewriteSignedUrls(nextProcessedSql, signedMap);
        setProcessedSql(signedSql);
        setError(null);
        setLoading(false);
        log("SQL preprocessing completed");
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "URL signing failed";
        setProcessedSql("");
        setError(msg);
        setLoading(false);
        log(`SQL preprocessing failed: ${msg}`, "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bridge,
    enabled,
    sql,
    refsKey,
    resolvedPlaceholders,
    sqlParamValues,
    sourceOverrides,
    sourceOverrideError,
    sourceOverrideLoading,
    hasUnresolvedOverride,
    maxRows,
    fetchKey,
    log,
    vfsRefs,
  ]);

  return { processedSql, loading, error, refetch };
}

/**
 * Execute a DuckDB SQL query against UDF Parquet outputs. Uses
 * `useDuckDbSqlQueryPreprocessing` to prepare the SQL string, then runs
 * it via the bridge.
 */
export function useDuckDbSqlQuery({
  sql,
  enabled = true,
  maxRows = DEFAULT_MAX_ROWS,
  sourceOverrides,
  queryId: queryIdOption,
}: UseDuckDbSqlQueryOptions): UseDuckDbSqlQueryResult {
  const bridge = useFusedWidgetBridge();
  const { startLoading: startEdgeLoading, stopLoading: stopEdgeLoading } =
    useJsonUiEdgeAnimation();
  const { log } = useJsonUiLog();

  // Server-resolved data seam: explicit option wins, else fall back to the
  // per-node binding context. `undefined` in every non-MCP host (no behavior
  // change for the workbench).
  const { queryId: queryIdBinding } = useJsonUiBinding();
  const queryId = queryIdOption ?? queryIdBinding;

  const [rows, setRows] =
    useState<ReadonlyArray<Record<string, unknown>>>(EMPTY_ROWS);
  const [columns, setColumns] = useState<readonly string[]>(EMPTY_COLUMNS);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const {
    processedSql,
    loading: preprocessingLoading,
    error: preprocessingError,
    refetch: refetchPreprocessing,
  } = useDuckDbSqlQueryPreprocessing({
    sql,
    enabled,
    maxRows,
    sourceOverrides,
  });

  // Bridges the single-frame gap between preprocessing completing and the
  // query effect starting — keeps `loading` true through that frame.
  const consumedSqlRef = useRef("");

  const awaitingExecution =
    enabled &&
    !!sql &&
    !!processedSql &&
    !preprocessingLoading &&
    !preprocessingError &&
    processedSql !== consumedSqlRef.current;

  const loading = preprocessingLoading || queryLoading || awaitingExecution;

  useEffect(() => {
    if (loading) startEdgeLoading();
    else stopEdgeLoading();
  }, [loading, startEdgeLoading, stopEdgeLoading]);

  const refetch = useCallback(() => {
    consumedSqlRef.current = "";
    refetchPreprocessing();
    setFetchKey((k) => k + 1);
  }, [refetchPreprocessing]);

  useEffect(() => {
    if (!enabled || !sql) {
      consumedSqlRef.current = "";
      setRows(EMPTY_ROWS);
      setColumns(EMPTY_COLUMNS);
      setQueryLoading(false);
      setError(null);
      return;
    }

    if (preprocessingError) {
      consumedSqlRef.current = "";
      setError(preprocessingError);
      setRows(EMPTY_ROWS);
      setColumns(EMPTY_COLUMNS);
      setQueryLoading(false);
      return;
    }

    if (preprocessingLoading || !processedSql) {
      consumedSqlRef.current = "";
      setQueryLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    consumedSqlRef.current = processedSql;
    setQueryLoading(true);
    setError(null);

    const truncatedSql =
      processedSql.length > 120
        ? processedSql.slice(0, 120) + "…"
        : processedSql;
    log(`SQL query started: ${truncatedSql}`);
    const t0 = performance.now();

    bridge.sql.query(processedSql, { signal: controller.signal, queryId }).then(
      (result) => {
        if (cancelled) return;
        const elapsed = Math.round(performance.now() - t0);
        if (result.error) {
          setRows(EMPTY_ROWS);
          setColumns(EMPTY_COLUMNS);
          setError(result.error);
          setQueryLoading(false);
          log(`SQL failed (${elapsed}ms): ${result.error}`, "error");
          return;
        }
        setRows(result.rows.length === 0 ? EMPTY_ROWS : result.rows);
        setColumns(result.columns);
        setError(null);
        setQueryLoading(false);
        log(
          `SQL completed: ${result.rows.length} row${
            result.rows.length !== 1 ? "s" : ""
          } in ${elapsed}ms`,
        );
      },
      (e: unknown) => {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "AbortError") return;
        const elapsed = Math.round(performance.now() - t0);
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "SQL query failed";
        setError(msg);
        setRows(EMPTY_ROWS);
        setColumns(EMPTY_COLUMNS);
        setQueryLoading(false);
        log(`SQL failed (${elapsed}ms): ${msg}`, "error");
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    bridge,
    enabled,
    sql,
    processedSql,
    preprocessingLoading,
    preprocessingError,
    fetchKey,
    log,
    queryId,
  ]);

  return { rows, columns, loading, error, refetch };
}

/**
 * Resolve UDF names to VFS filenames, registering them in DuckDB if needed.
 * Exposed for advanced use cases (e.g. building your own query string).
 */
export function useVfsRegistration(
  udfNames: readonly string[],
  enabled: boolean = true,
): {
  filenames: Map<string, string>;
  loading: boolean;
  error?: string;
} {
  const bridge = useFusedWidgetBridge();
  const [state, setState] = useState<{
    filenames: Map<string, string>;
    loading: boolean;
    error?: string;
  }>({ filenames: new Map(), loading: false });

  const namesKey = useMemo(() => udfNames.slice().sort().join("|"), [udfNames]);

  useEffect(() => {
    if (!enabled || udfNames.length === 0) {
      setState({ filenames: new Map(), loading: false });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    bridge.sql.resolveVfsFilenames(udfNames).then(
      (result) => {
        if (cancelled) return;
        const filenames = result instanceof Map ? result : result.filenames;
        setState({ filenames, loading: false });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          filenames: new Map(),
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, namesKey, enabled]);

  return state;
}
