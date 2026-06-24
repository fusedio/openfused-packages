/**
 * JsonUiBindingContext — per-node data-binding identity (chunk-2 MCP-host seam).
 *
 * When a host resolves a widget's data server-side (the MCP Apps renderer), it
 * stamps a deterministic `_queryId` into each data-bound node's props and wraps
 * that node's renderer in a `<JsonUiBindingContext.Provider value={{queryId}}>`.
 * SDK data hooks (currently `useDuckDbSqlQuery`) read the id via
 * `useJsonUiBinding()` and thread it into `bridge.sql.query(sql, { queryId })`,
 * letting the static MCP bridge look up the pre-resolved rows by id instead of
 * running DuckDB in the sandbox.
 *
 * The default value is `{}` (no binding). In every other host (workbench, test
 * harness, mobile) the provider is absent, `queryId` is `undefined`, and the
 * hooks behave exactly as before — so this seam is fully backward-compatible and
 * data-bound components never need editing.
 */
import { createContext, useContext } from "react";

export interface JsonUiBinding {
  /** Resolver-stamped query id for this node (e.g. `"q0"`); undefined elsewhere. */
  queryId?: string;
}

export const JsonUiBindingContext = createContext<JsonUiBinding>({});
JsonUiBindingContext.displayName = "JsonUiBindingContext";

/** Read the current node's data-binding identity. `{}` when no provider is present. */
export function useJsonUiBinding(): JsonUiBinding {
  return useContext(JsonUiBindingContext);
}
