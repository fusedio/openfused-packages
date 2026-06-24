/**
 * Pure parsing/substitution utilities for widget SQL strings.
 *
 * Two syntaxes are recognised:
 *   - `$param_name` — canvas/form param reference, substituted inline.
 *   - `{{udf_name}}` or `{{udf_name?k=v&k2=v2}}` — UDF Parquet placeholder,
 *     optionally with override params. Override suffixes accept `&` or `,`
 *     as separators and URL-decoded keys/values.
 *
 * These helpers are also used by the host (workbench bridge) for VFS
 * registration; lifting them into the SDK keeps a single source of truth.
 */

export const SQL_PARAM_REGEX = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
export const SQL_SOURCE_PLACEHOLDER_REGEX = /\{\{(\w+)(?:\?([^}]*))?\}\}/g;

/**
 * Matches `'scheme://...'` literals inside a SQL string. We deliberately
 * limit to single-quoted string literals so that bare identifiers or
 * comments containing a URL-like token aren't treated as paths to sign.
 */
export const SIGNABLE_URL_LITERAL_REGEX = /'((?:s3|gs|fd):\/\/[^'\n]+)'/g;

export function escapeSqlValue(value: unknown): string {
  if (value == null) return "''";
  if (typeof value === "number" && !Number.isNaN(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function isInsideSingleQuotedSqlString(sql: string, offset: number): boolean {
  let inString = false;
  for (let i = 0; i < offset; i++) {
    if (sql[i] !== "'") continue;
    if (inString && sql[i + 1] === "'") {
      i++;
      continue;
    }
    inString = !inString;
  }
  return inString;
}

/**
 * Substitute `$param_name` references directly into the SQL string. When a
 * `$param` lives inside a single-quoted string literal, only the raw
 * quote-escaped value is spliced in so we don't add nested quotes.
 */
export function substituteSqlParams(
  sql: string,
  paramValues: Record<string, unknown>,
): string {
  return sql.replace(SQL_PARAM_REGEX, (_match, paramName, offset: number) => {
    const value = paramValues[paramName];
    const raw = value == null ? "" : String(value);
    if (isInsideSingleQuotedSqlString(sql, offset)) {
      return raw.replace(/'/g, "''");
    }
    return escapeSqlValue(value);
  });
}

/** Extract all SQL parameter names from `$param_name` references. */
export function extractSqlParams(sql: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  SQL_PARAM_REGEX.lastIndex = 0;
  for (const m of sql.matchAll(SQL_PARAM_REGEX)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export interface SqlUdfPlaceholder {
  /** Full match text including braces, e.g. `{{udf?city=NYC}}` */
  match: string;
  /** UDF name, e.g. `udf` */
  name: string;
  /**
   * Parsed override params if the placeholder contains a `?...` suffix,
   * otherwise `null`. Values are raw (URL-decoded) strings — they may still
   * contain `$param` references that need canvas/form resolution.
   */
  overrides: Record<string, string> | null;
  start: number;
  end: number;
}

export function parseOverridesString(
  rawOverrides: string | undefined,
): Record<string, string> | null {
  if (!rawOverrides) return null;
  const result: Record<string, string> = {};
  let parsedAny = false;
  for (const pair of rawOverrides.split(/[&,]/)) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const rawKey = pair.slice(0, eq);
    const rawValue = pair.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey);
      value = decodeURIComponent(rawValue);
    } catch {
      key = rawKey;
      value = rawValue;
    }
    if (!key) continue;
    result[key] = value;
    parsedAny = true;
  }
  return parsedAny ? result : null;
}

/**
 * Parse every `{{udf}}` or `{{udf?k=v&k2=v2}}` placeholder. Returns
 * occurrences in source order, preserving duplicates so callers can
 * substitute by start/end offsets.
 */
export function parseSqlUdfPlaceholders(sql: string): SqlUdfPlaceholder[] {
  const placeholders: SqlUdfPlaceholder[] = [];
  let match: RegExpExecArray | null;
  SQL_SOURCE_PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = SQL_SOURCE_PLACEHOLDER_REGEX.exec(sql)) !== null) {
    const [fullMatch, name, rawOverrides] = match;
    placeholders.push({
      match: fullMatch,
      name,
      overrides: parseOverridesString(rawOverrides),
      start: match.index,
      end: match.index + fullMatch.length,
    });
  }
  return placeholders;
}

/**
 * Extract every signable URL appearing as a single-quoted string literal,
 * deduped, in first-occurrence order.
 */
export function extractSignableUrls(sql: string): string[] {
  if (!sql) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  SIGNABLE_URL_LITERAL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SIGNABLE_URL_LITERAL_REGEX.exec(sql)) !== null) {
    const url = match[1];
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Replace every signable URL literal in `sql` with its signed counterpart
 * from `signedMap`. Literals whose URL is missing from the map are left
 * untouched.
 */
export function rewriteSignedUrls(
  sql: string,
  signedMap: Record<string, string>,
): string {
  if (!sql) return sql;
  return sql.replace(SIGNABLE_URL_LITERAL_REGEX, (literal, url: string) => {
    const signed = signedMap[url];
    if (!signed) return literal;
    return `'${signed}'`;
  });
}

// ============================================================================
// Override-param resolution
// ============================================================================

const DOLLAR_REF_RE = /^\$([a-zA-Z_][a-zA-Z0-9_]*)$/;

/** Return the param name if `value` is a single `$name` reference. */
export function getDollarRefName(value: string): string | null {
  const trimmed = value.trim();
  const m = DOLLAR_REF_RE.exec(trimmed);
  return m ? m[1] : null;
}

export interface ResolvedOverrideValue {
  value: string;
  unresolved: boolean;
}

/**
 * Resolve a raw override value. If the entire value is a `$name` reference,
 * substitute the param value; otherwise return verbatim. When the param is
 * missing entirely (key not in the map), marks the result as `unresolved`
 * so callers can keep the placeholder pending until upstream params settle.
 */
export function resolveOverrideValue(
  rawValue: string,
  paramValues: Record<string, unknown>,
): ResolvedOverrideValue {
  const m = DOLLAR_REF_RE.exec(rawValue);
  if (!m) {
    return { value: rawValue, unresolved: false };
  }
  const name = m[1];
  if (!(name in paramValues)) {
    return { value: rawValue, unresolved: true };
  }
  const resolved = paramValues[name];
  if (resolved == null) {
    return { value: "", unresolved: false };
  }
  return { value: String(resolved), unresolved: false };
}

/**
 * Canonical registry key for `(name, overrides)`. Bare placeholders use the
 * name alone; overrides are sorted by key and joined with `&`.
 */
export function canonicalOverrideKey(
  overrides: Record<string, string>,
): string {
  return Object.keys(overrides)
    .sort()
    .map((k) => `${k}=${overrides[k]}`)
    .join("&");
}

export function computePlaceholderKey(
  name: string,
  overrides: Record<string, string> | null,
): string {
  if (!overrides) return name;
  return `${name}#${canonicalOverrideKey(overrides)}`;
}
