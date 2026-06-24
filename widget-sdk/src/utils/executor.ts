/**
 * Pure parsing for "executor" strings — a declarative reference to a UDF that
 * a component runs in response to an event (button click, form submit, …).
 *
 * The grammar matches the body of an inline `{{udf?...}}` placeholder, minus
 * the column/row access path:
 *
 *   "udf_name"
 *   "udf_name?key=value"
 *   "udf_name?city=$selected_city&limit=10"
 *
 * Override values may contain `$param` references; those are resolved against
 * canvas/form params at fire time (see `resolveOverrideValue`) — exactly the
 * same substitution the SQL widget, iframe, and inline templates use. The
 * override suffix accepts `&` or `,` separators and URL-decoded keys/values
 * (delegated to `parseOverridesString`).
 */
import { parseOverridesString } from "./sql-placeholders";

const EXECUTOR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface ParsedExecutor {
  /** UDF name to run. */
  name: string;
  /**
   * Raw override params (URL-decoded). Values may still contain a `$param`
   * reference that needs canvas/form resolution before execution.
   */
  overrides: Record<string, string>;
}

/**
 * Parse an executor string into `{ name, overrides }`. Returns `null` when the
 * string is empty/blank or the UDF name is not a valid identifier — callers
 * treat `null` as "nothing to run".
 *
 * @example
 * parseExecutor("send_email")                 // { name: "send_email", overrides: {} }
 * parseExecutor("ingest?city=$city&dry=true") // { name: "ingest", overrides: { city: "$city", dry: "true" } }
 * parseExecutor("  ")                          // null
 */
export function parseExecutor(
  executor: string | null | undefined,
): ParsedExecutor | null {
  if (!executor) return null;
  const trimmed = executor.trim();
  if (!trimmed) return null;

  const queryStart = trimmed.indexOf("?");
  const name = (
    queryStart === -1 ? trimmed : trimmed.slice(0, queryStart)
  ).trim();
  if (!EXECUTOR_NAME_RE.test(name)) return null;

  const rawOverrides =
    queryStart === -1 ? undefined : trimmed.slice(queryStart + 1);
  return { name, overrides: parseOverridesString(rawOverrides) ?? {} };
}
