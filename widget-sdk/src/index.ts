/**
 * @fusedio/widget-sdk — public surface.
 *
 * This SDK has two parts:
 *
 *   1. **Provider contract** — `FusedWidgetBridge` + `FusedWidgetBridgeContext`.
 *      Hosts (the Fused workbench, the catalog-template test harness, any
 *      future embedder) implement the bridge and provide it via the context.
 *
 *   2. **Hooks** — every API a component author needs. Hooks read the bridge
 *      from context and delegate state management to it. Authors call hooks;
 *      the bridge is invisible to them.
 *
 * Catalog components depend only on these hooks and types. They do not need
 * to know about Jotai, BroadcastChannel internals, or the workbench source.
 */

// ── Part 1: Provider contract ────────────────────────────────────────────────
export * from "./protocol";
export * from "./bridge";
export * from "./form";

// ── Part 2: Hook types ───────────────────────────────────────────────────────
export * from "./types";

// ── Part 3: Catalog component registration ───────────────────────────────────
export {
  defineComponent,
  type CatalogComponentDefinition,
} from "./define-component";
export {
  defineCatalog,
  type CatalogDefinition,
  type CatalogDefinitionBase,
  type CatalogDefinitionWithSkill,
} from "./define-catalog";

// ── Part 2: Hooks ────────────────────────────────────────────────────────────
export { useFusedParam } from "./hooks/use-fused-param";
export { useFusedParamWithForm } from "./hooks/use-fused-param-with-form";
export { useCanvasParams } from "./hooks/use-canvas-params";
export { useAllowedSources } from "./hooks/use-allowed-sources";
export { useAllowedUdfNames } from "./hooks/use-allowed-udf-names";
export { useParamSubstitution } from "./hooks/use-param-substitution";
export {
  useUdfOutputByName,
  useRequestUdfReexecute,
  useUdfDataFrameSample,
  useUdfColumnValue,
  useUdfColumnValues,
  isUdfQuery,
  parseUdfColumnQuery,
  type ParsedUdfQuery,
  type UseUdfDataFrameSampleOptions,
  type UseUdfDataFrameSampleResult,
  type UseUdfColumnValueResult,
  type UseUdfColumnValuesResult,
} from "./hooks/use-udf-output";
export {
  useDuckDbSqlQuery,
  useDuckDbSqlQueryPreprocessing,
  useVfsRegistration,
  type UseDuckDbSqlQueryOptions,
  type UseDuckDbSqlQueryResult,
  type UseDuckDbSqlQueryPreprocessingResult,
} from "./hooks/use-duckdb-sql";
export {
  SqlSourceOverrideContext,
  useSqlSourceOverrides,
  type SqlSourceOverride,
  type SqlSourceOverrideMap,
} from "./hooks/sql-source-overrides";
export {
  useUrlSigning,
  useMediaSrc,
  SIGNED_URL_SCHEMES,
  type UseMediaSrcResult,
} from "./hooks/use-url-signing";
export {
  useUploadAccessCheck,
  type UploadAccessState,
} from "./hooks/use-upload-access-check";
export {
  useJsonUiLog,
  useJsonUiLogs,
  useJsonUiLogClear,
} from "./hooks/use-json-ui-log";
export { useJsonUiUdfInfo } from "./hooks/use-json-ui-udf-info";
export { useJsonUiEdgeAnimation } from "./hooks/use-json-ui-edge-animation";
export {
  useUdfExecutor,
  type UseUdfExecutorOptions,
  type UseUdfExecutorResult,
  type UdfExecutorStatus,
} from "./hooks/use-udf-executor";
export {
  JsonUiBindingContext,
  useJsonUiBinding,
  type JsonUiBinding,
} from "./hooks/json-ui-binding";

// ── Pure utilities (re-exported for advanced workbench paths) ────────────────
export * from "./utils/sql-placeholders";
export { parseStyle } from "./utils/parse-style";
export { parseExecutor, type ParsedExecutor } from "./utils/executor";
