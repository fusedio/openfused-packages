/**
 * Host-provided SQL source overrides.
 *
 * Lets a host replace `{{name}}` SQL placeholders with an in-memory DuckDB
 * relation instead of the UDF's VFS Parquet file. The Fused workbench's
 * `sql-runner` component provides these for its descendant json-ui widgets
 * (so a chart/metric/text nested under a sql-runner reads its in-memory tab);
 * other hosts (MCP, test harness) leave it empty.
 *
 * The SDK SQL hooks (`useDuckDbSqlQuery` / `useDuckDbSqlQueryPreprocessing`)
 * read this context automatically and merge it with any explicit
 * `sourceOverrides` option, so component authors never thread it manually.
 */
import { createContext, useContext } from "react";

export interface SqlSourceOverride {
  /** In-memory DuckDB relation name to substitute for the `{{name}}` placeholder. */
  relationName: string;
  /** Error from materializing the source, if any. */
  error?: string;
  /** True while the source is still materializing. */
  loading?: boolean;
}

export type SqlSourceOverrideMap = Record<string, SqlSourceOverride>;

const EMPTY_OVERRIDES: SqlSourceOverrideMap = Object.freeze({});

/**
 * Provided by hosts that expose named in-memory SQL sources to descendant
 * widgets. Defaults to empty — most hosts and most subtrees have no overrides.
 */
export const SqlSourceOverrideContext =
  createContext<SqlSourceOverrideMap>(EMPTY_OVERRIDES);
SqlSourceOverrideContext.displayName = "SqlSourceOverrideContext";

/** Read the ancestor-provided SQL source overrides (empty map when none). */
export function useSqlSourceOverrides(): SqlSourceOverrideMap {
  return useContext(SqlSourceOverrideContext);
}
