/**
 * FusedWidgetBridge — the dependency-injection interface between SDK hooks
 * and the host environment (workbench, test harness, mobile app, etc).
 *
 * The SDK hooks (`useFusedParam`, `useParamSubstitution`, `useUdfOutputByName`,
 * `useDuckDbSqlQuery`, …) read this bridge from `FusedWidgetBridgeContext`
 * and delegate all state management to it. Catalog component authors only
 * call hooks; they never touch the bridge directly.
 *
 * Hosts implement this interface to inject their own state stores:
 *   - The Fused workbench wires Jotai atoms, DuckDB, fetcher, log atom.
 *   - The catalog-template test harness uses in-memory Map storage.
 *   - Any future host (mobile, embedded) can implement their own.
 */
import { createContext, useContext } from "react";

import type { ParameterMessageType } from "./protocol";

// ============================================================================
// Top-level bridge
// ============================================================================

export interface FusedWidgetBridge {
  /** Canvas parameter state (edge-filtered, two-way). */
  params: ParamBridge;
  /** UDF output data and re-execution. */
  udfs: UdfBridge;
  /** Identity of the current canvas node. */
  node: NodeIdentity;
  /** Edge animation control. */
  edges: EdgeAnimationBridge;
  /** Edge-based routing capabilities. */
  routing: RoutingBridge;
  /** DuckDB SQL execution against UDF Parquet outputs. */
  sql: SqlBridge;
  /** Template rendering for `$param` + `{{udf}}` substitution. */
  template: TemplateBridge;
  /** File-upload access checks. */
  uploads: UploadBridge;
  /** Sign an S3/GCS/FD URL with the current user's access token. */
  signUrl(url: string): Promise<SignUrlResult>;
  /** Per-node logging (visible in the runtime logs panel). */
  log: LogBridge;
}

// ============================================================================
// ParamBridge
// ============================================================================

export interface ParamBridge {
  /**
   * Subscribe to changes for a single canvas parameter.
   * Designed for use with React.useSyncExternalStore — callback takes no args.
   * Returns an unsubscribe function.
   */
  subscribe(param: string, cb: () => void): () => void;
  /** Synchronously read the current edge-filtered value for a param. */
  getSnapshot(param: string): unknown;
  /** Subscribe to changes for *any* of a list of params. */
  subscribeMany(params: readonly string[], cb: () => void): () => void;
  /** Read snapshot for many params at once (edge-filtered). */
  getSnapshotMany(params: readonly string[]): Record<string, unknown>;
  /** Broadcast a parameter value to the canvas (typed). */
  set(param: string, value: unknown, type?: ParameterMessageType): void;
  /** Clear a parameter: send CLEAR for this source. */
  clear(param: string): void;
}

// ============================================================================
// UdfBridge
// ============================================================================

export interface UdfBridge {
  /** Subscribe to changes in a UDF's results (output data + execution status). */
  subscribeOutput(udfName: string, cb: () => void): () => void;
  /** Get the current snapshot of a UDF's results. */
  getOutputSnapshot(udfName: string): UdfOutputSnapshot | undefined;
  /** Request the workbench to re-execute a UDF. */
  requestReexecute(udfName: string): void;
  /**
   * Imperatively run a named UDF with already-resolved query-param overrides
   * and return its decoded output. One-shot request/response: unlike
   * `requestReexecute`, this does NOT mutate canvas param state or the node's
   * own results. It is the primitive behind event-driven execution — e.g.
   * `useUdfExecutor` (a button click runs `udf?param=1`).
   *
   * `overrides` are fully resolved by the SDK before this is called — no
   * `$param` references remain. Hosts that cannot execute UDFs (e.g. a minimal
   * test harness) should reject the returned promise or resolve with `error`;
   * `useUdfExecutor` surfaces either as an error state.
   */
  execute(
    udfName: string,
    overrides: Record<string, string>,
    options?: UdfExecuteOptions,
  ): Promise<UdfExecuteResult>;
}

export interface UdfExecuteOptions {
  /**
   * Desired output format. The host decodes the response accordingly:
   * `"json"` → parsed JSON value, `"html"`/`"text"` → string, others are
   * host-defined. When omitted the host picks its default (typically `"json"`).
   */
  format?: string;
  /** Optional cancellation signal forwarded to the host's fetch. */
  signal?: AbortSignal;
}

export interface UdfExecuteResult {
  /**
   * Decoded UDF output. Shape depends on the requested `format` (parsed JSON
   * value, HTML/text string, …). `null` when `error` is set.
   */
  data: unknown;
  /** Human-readable error message when execution failed; omitted on success. */
  error?: string;
}

export interface UdfOutputSnapshot {
  /** The UDF result data — TableDataSource, HTML blob, array, etc. */
  data: unknown;
  /** True while the UDF is currently executing. */
  isExecutionInProgress: boolean;
  /** Error message if the most recent execution failed. */
  error?: string;
  /** VFS filename for DuckDB queries (e.g. `"<udfName>.parquet"`). */
  vfsFilename?: string;
}

// ============================================================================
// NodeIdentity
// ============================================================================

export interface NodeIdentity {
  /** Unique ID of the current canvas node (regenerated on page reload). */
  udfUniqueId?: string;
  /** Human-readable name of the current node (stable across reloads). */
  udfName?: string;
  /** Hash of the current widget JSON config. Changes when the JSON is edited. */
  configHash?: string;
}

// ============================================================================
// EdgeAnimationBridge
// ============================================================================

export interface EdgeAnimationBridge {
  /** Start the edge-animating loading state for the current node. */
  startLoading(): void;
  /** End the loading state — fires the edge pellet on the true→false transition. */
  stopLoading(): void;
}

// ============================================================================
// RoutingBridge
// ============================================================================

/** Identity of a UDF allowed to broadcast params to the current node. */
export interface AllowedSource {
  udfUniqueId?: string;
  udfName?: string;
}

export interface RoutingBridge {
  /** Subscribe to changes in allowed sources (canvas topology changes). */
  subscribeAllowedSources(cb: () => void): () => void;
  /** Get the set of UDF names this node may reference. `null` = no filtering. */
  getAllowedUdfNames(): Set<string> | null;
  /** Get the allowed source identities for this node. `null` = no filtering. */
  getAllowedSources(): ReadonlyArray<AllowedSource> | null;
}

// ============================================================================
// SqlBridge
// ============================================================================

export interface SqlQueryOptions {
  defaultLimit?: number;
  signal?: AbortSignal;
  /**
   * Optional binding identity (chunk-2 MCP-host seam). When the host resolves
   * data server-side (the MCP Apps renderer), it stamps a `_queryId` into each
   * data-bound node's props and the SDK threads it here so the static bridge can
   * look up the pre-resolved rows by id. The workbench bridge ignores this field
   * (it runs the query against DuckDB regardless), so it is fully
   * backward-compatible.
   */
  queryId?: string;
}

export interface SqlQueryResult {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns: readonly string[];
  error?: string;
}

/**
 * A reference to a `{{udf}}` or `{{udf?k=v}}` placeholder, used by
 * `bridge.sql.resolveVfsFilenames` to register UDFs (including overrides).
 *
 * `key` is the canonical registry key that consumers should use to look up
 * the resolved filename in the returned Map. Bare `{{udf}}` references use
 * `key === name`; override references use `computePlaceholderKey(name, overrides)`.
 */
export interface VfsResolveRef {
  name: string;
  key: string;
  overrides?: Record<string, string>;
}

export interface VfsResolveResult {
  /** Map of `ref.key` → resolved VFS filename (e.g. `"my_udf.parquet"`). */
  filenames: Map<string, string>;
  /** Per-key error messages for refs that failed to register. */
  errors?: Map<string, string>;
}

export interface SqlBridge {
  /** Execute a SQL query against UDF Parquet outputs via DuckDB. */
  query(sql: string, options?: SqlQueryOptions): Promise<SqlQueryResult>;
  /**
   * Resolve UDF references to VFS filenames; registers any UDFs (and
   * override variants) not yet in VFS. Returns a map keyed by `ref.key`.
   *
   * When called with bare string names, the legacy `Map<name, filename>`
   * shape is preserved for backward compatibility with the previous bridge
   * surface — but new callers should pass `VfsResolveRef[]`.
   */
  resolveVfsFilenames(
    refs: readonly VfsResolveRef[] | readonly string[],
  ): Promise<VfsResolveResult | Map<string, string>>;
}

// ============================================================================
// TemplateBridge — host-side rendering of `{{udf}}` placeholders
// ============================================================================

export interface TemplateRenderOptions {
  /** When true, leave unresolved `$param` tokens intact rather than replacing with empty string. */
  preserveMissingParams?: boolean;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
}

export interface TemplateRenderResult {
  /** The rendered string with `$param` and `{{udf}}` placeholders replaced. */
  value: string;
  /** True if any UDF placeholder is still loading (data not yet available). */
  loading: boolean;
}

export interface TemplateBridge {
  /**
   * Asynchronously render a template containing `$param` and `{{udf}}`
   * placeholders. Resolves UDF dependencies, fetches override variants if
   * needed, and stringifies the result.
   *
   * The host owns the rendering machinery (UDF result access, allowed-UDF
   * routing, HTML template node recursion, override fetching). The SDK
   * orchestrates re-runs when params change.
   */
  render(
    template: string,
    paramValues: Record<string, unknown>,
    options?: TemplateRenderOptions,
  ): Promise<TemplateRenderResult>;
  /**
   * Synchronously render a loading placeholder for the template (used to
   * keep the UI populated while async render is in flight). Should not
   * touch any UDFs — only `$param` substitution and best-effort HTML
   * template node substitution from already-available data.
   */
  renderLoading(
    template: string,
    paramValues: Record<string, unknown>,
    options?: TemplateRenderOptions,
  ): string;
  /**
   * Subscribe to events that should cause a re-render: UDF outputs changing,
   * topology shifts, etc. The callback should be invoked any time
   * `render()` could now produce a different result for the *same* inputs.
   */
  subscribe(cb: () => void): () => void;
}

// ============================================================================
// UploadBridge — file-upload access checks
// ============================================================================

export interface UploadAccessResult {
  ok: boolean;
  /** When ok=false, a human-readable message; otherwise omitted. */
  message?: string;
}

export interface UploadBridge {
  /**
   * Check whether the current user has write access to a destination path
   * (S3, GCS, etc.). Used by the `file-upload` widget to surface a clear
   * error before the user attempts to upload.
   */
  checkAccess(destinationPath: string): Promise<UploadAccessResult>;
}

// ============================================================================
// SignUrl
// ============================================================================

export interface SignUrlResult {
  /** The signed URL (or the original URL if signing was not needed). */
  signed: string;
  /** True if the URL needed signing (false for non-S3/GCS/FD URLs). */
  needsSigning: boolean;
}

// ============================================================================
// LogBridge
// ============================================================================

export type JsonUiLogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** Epoch millis of when this entry was created. */
  timestamp: number;
  level: JsonUiLogLevel;
  message: string;
  /** Hash of the widget config that produced this entry (for staleness detection). */
  configHash?: string;
}

export interface LogBridge {
  /**
   * Append a log entry for the current node.
   *
   * `configHash` is optional — when provided (by the SDK's `useJsonUiLog`,
   * which reads it from `JsonUiNodeOverrideContext`), the entry is tagged
   * with that hash so nested `JsonUiConfigHashOverride` subtrees emit
   * correctly-scoped entries without rebuilding the bridge. When omitted,
   * the bridge falls back to its own node identity.
   */
  log(message: string, level?: JsonUiLogLevel, configHash?: string): void;
  /** Subscribe to log changes for a node. */
  subscribeLogs(nodeId: string, cb: () => void): () => void;
  /** Get the log entries snapshot for a node. */
  getLogsSnapshot(nodeId: string): readonly LogEntry[];
  /** Clear all log entries for a node. */
  clearLogs(nodeId: string): void;
}

// ============================================================================
// React context
// ============================================================================

/**
 * Context that carries the FusedWidgetBridge instance.
 * Provided by the workbench's `<JsonUiProvider>` and by the test harness.
 * Catalog authors never interact with this directly — use the hooks.
 */
export const FusedWidgetBridgeContext = createContext<FusedWidgetBridge | null>(
  null,
);
FusedWidgetBridgeContext.displayName = "FusedWidgetBridgeContext";

/**
 * Internal helper used by all SDK hooks. Throws if used outside a
 * `<FusedWidgetBridgeContext.Provider>` so misconfiguration fails loudly.
 */
export function useFusedWidgetBridge(): FusedWidgetBridge {
  const bridge = useContext(FusedWidgetBridgeContext);
  if (!bridge) {
    throw new Error(
      "useFusedWidgetBridge: no FusedWidgetBridgeContext provider in the tree. " +
        "Wrap your components with the workbench's <JsonUiProvider> or the " +
        "test harness's <FusedWidgetBridgeContext.Provider value={createTestBridge()}>.",
    );
  }
  return bridge;
}

// ============================================================================
// Node-identity override context
// ============================================================================

/**
 * Per-subtree override of the bridge's node identity. When present, SDK hooks
 * like `useJsonUiUdfInfo` and `useJsonUiLog` read these fields instead of
 * `bridge.node`. Lets nested `JsonUiConfigHashOverride` providers tag log
 * entries with their own `configHash` without rebuilding the entire bridge,
 * which would otherwise cascade through every `useSyncExternalStore`
 * subscription in the subtree.
 *
 * Hosts populate this from their JsonUiProvider props.
 */
export interface JsonUiNodeOverride {
  udfUniqueId?: string;
  udfName?: string;
  configHash?: string;
}

export const JsonUiNodeOverrideContext =
  createContext<JsonUiNodeOverride | null>(null);
JsonUiNodeOverrideContext.displayName = "JsonUiNodeOverrideContext";

/**
 * Internal helper that resolves the effective node identity for SDK hooks.
 * Reads `JsonUiNodeOverrideContext` first (per-subtree override), falls back
 * to `bridge.node` (per-provider identity).
 */
export function useJsonUiNode(): {
  udfUniqueId: string | undefined;
  udfName: string | undefined;
  configHash: string | undefined;
} {
  const bridge = useFusedWidgetBridge();
  const override = useContext(JsonUiNodeOverrideContext);
  if (override) {
    return {
      udfUniqueId: override.udfUniqueId ?? bridge.node.udfUniqueId,
      udfName: override.udfName ?? bridge.node.udfName,
      configHash: override.configHash ?? bridge.node.configHash,
    };
  }
  return {
    udfUniqueId: bridge.node.udfUniqueId,
    udfName: bridge.node.udfName,
    configHash: bridge.node.configHash,
  };
}
