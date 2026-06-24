/**
 * GOLDEN parity test for the json-ui SQL grammar (review #8 / #3.1) — TS side.
 *
 * Loads the SAME shared fixture the server planner test pins
 * (`server/tests/fixtures/sql_grammar_golden.json`) and asserts the client-side
 * grammar — `sql-placeholders.ts` (parse / override-resolve / key / `$param`
 * substitution) plus `use-duckdb-sql.ts`'s `buildProcessedSql` logic (single-
 * `$param`-whole-SQL, right-to-left placeholder splice, `appendLimitIfMissing`,
 * identifier escaping) — produces the SAME `expectedProcessedSql` and the SAME
 * distinct-relation runs (`udf_rel_0/1`) as the Python planner.
 *
 * Why this re-derives `buildProcessedSql` here instead of calling the SDK hook:
 * the SDK's `useDuckDbSqlQuery` is a React hook bound to a host bridge, and its
 * private `buildProcessedSql` substitutes `{{udf}}` with a Parquet *filename*
 * (`'udf.parquet'`) — a HOST registration detail, not the grammar. The headless
 * server resolver substitutes the same placeholder with a DuckDB *relation*
 * identifier (`"udf_rel_0"`). Both walk the IDENTICAL grammar (the exported pure
 * functions below); only the replacement string differs by host. To prove the
 * grammar itself can't drift, this test drives those exported functions through
 * the SAME relation-substitution + run-assignment the server uses. The two
 * private helpers (`appendLimitIfMissing`, `escapeSqlIdentifier`) are copied
 * verbatim from `use-duckdb-sql.ts` — if either drifts there, update here too
 * (and the server's port, which is byte-identical).
 *
 * RUNNER: `bun test` (zero extra toolchain — widget-sdk has no jest/vitest, and
 * bun runs TS directly). From the widget-sdk dir:
 *
 *     cd widget-sdk && bun test src/__tests__/sql-grammar-parity.test.ts
 *
 * If migrating to jest/vitest later, swap the `bun:test` import for
 * `@jest/globals` / `vitest` — the assertions are runner-agnostic.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  parseSqlUdfPlaceholders,
  resolveOverrideValue,
  computePlaceholderKey,
  substituteSqlParams,
  extractSqlParams,
  getDollarRefName,
  type SqlUdfPlaceholder,
} from "../utils/sql-placeholders";

// ---------------------------------------------------------------------------
// Private helpers copied verbatim from use-duckdb-sql.ts (not exported there).
// These are part of the grammar contract the server ports byte-for-byte.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Relation-substitution flavour of buildProcessedSql + run assignment.
//
// This mirrors the SERVER planner's `_build_processed_sql` + `_plan_binding`
// exactly (server/server/mcp/resolver_planner.py), but reuses the SHARED
// exported grammar functions so any drift in parsing / override resolution /
// key computation / param substitution is caught. The only deliberate
// difference from the SDK hook is the replacement string: a DuckDB relation
// identifier (`"udf_rel_N"`) rather than a Parquet filename.
// ---------------------------------------------------------------------------

interface Run {
  target: string;
  relation: string;
  parameters: Record<string, string> | null;
}

function udfRunTarget(
  shareToken: string,
  name: string,
  separator: string,
): string {
  if (!shareToken) return name;
  return `${shareToken}${separator}${name}`;
}

function resolveKeyAndParams(
  p: SqlUdfPlaceholder,
  params: Record<string, unknown>,
): { key: string; parameters: Record<string, string> | null } {
  if (p.overrides === null) {
    return { key: p.name, parameters: null };
  }
  const resolvedOverrides: Record<string, string> = {};
  for (const [paramKey, rawValue] of Object.entries(p.overrides)) {
    const { value } = resolveOverrideValue(rawValue, params);
    resolvedOverrides[paramKey] = value;
  }
  return {
    key: computePlaceholderKey(p.name, resolvedOverrides),
    parameters: resolvedOverrides,
  };
}

/** Port of the server's `_plan_binding`: distinct runs in first-seen key order. */
function planRuns(
  sql: string,
  shareToken: string,
  separator: string,
  params: Record<string, unknown>,
): { relationNames: Map<string, string>; runs: Run[] } {
  const relationNames = new Map<string, string>();
  const runs: Run[] = [];
  for (const p of parseSqlUdfPlaceholders(sql)) {
    const { key, parameters } = resolveKeyAndParams(p, params);
    if (relationNames.has(key)) continue;
    const relation = `udf_rel_${relationNames.size}`;
    relationNames.set(key, relation);
    runs.push({
      target: udfRunTarget(shareToken, p.name, separator),
      relation,
      parameters,
    });
  }
  return { relationNames, runs };
}

/** Port of the server's `_build_processed_sql` (relation flavour). */
function buildProcessedSqlRelations(
  sql: string,
  relationNames: Map<string, string>,
  params: Record<string, unknown>,
  maxRows: number,
): string {
  const singleParam = sql.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (singleParam) {
    const val = params[singleParam[1]];
    return val == null ? "" : appendLimitIfMissing(String(val), maxRows);
  }

  const placeholders = parseSqlUdfPlaceholders(sql);
  let processed = sql;
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const p = placeholders[i];
    const { key } = resolveKeyAndParams(p, params);
    const relation = relationNames.get(key) ?? p.name;
    const replacement = escapeSqlIdentifier(relation);
    processed =
      processed.slice(0, p.start) + replacement + processed.slice(p.end);
  }

  processed = appendLimitIfMissing(processed, maxRows);
  return substituteSqlParams(processed, params);
}

/** Port of the server's `_build_dep_map` for a single binding (queryId fixed). */
function buildDepMap(sql: string, queryId: string): Record<string, string[]> {
  const depMap: Record<string, string[]> = {};
  const referenced: string[] = [];
  const seen = new Set<string>();
  for (const name of extractSqlParams(sql)) {
    if (!seen.has(name)) {
      seen.add(name);
      referenced.push(name);
    }
  }
  for (const p of parseSqlUdfPlaceholders(sql)) {
    if (!p.overrides) continue;
    for (const rawValue of Object.values(p.overrides)) {
      const name = getDollarRefName(rawValue);
      if (name && !seen.has(name)) {
        seen.add(name);
        referenced.push(name);
      }
    }
  }
  for (const name of referenced) {
    depMap[name] = [queryId];
  }
  return depMap;
}

// ---------------------------------------------------------------------------
// Load the SHARED golden fixture (generated by the server planner).
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dir,
  "../../../server/tests/fixtures/sql_grammar_golden.json",
);

interface GoldenRun {
  target: string;
  relation: string;
  parameters: Record<string, string> | null;
}
interface GoldenCase {
  name: string;
  sql: string;
  params: Record<string, unknown>;
  shareToken: string;
  expectedQueryId: string;
  expectedProcessedSql: string;
  expectedRuns: GoldenRun[];
  expectedDepMap: Record<string, string[]>;
}
interface GoldenFixture {
  defaultMaxRows: number;
  separator: string;
  cases: GoldenCase[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GoldenFixture;

test("golden fixture is well-formed", () => {
  expect(fixture.defaultMaxRows).toBe(500);
  expect(fixture.separator).toBe("/");
  expect(fixture.cases.length).toBeGreaterThanOrEqual(12);
});

for (const c of fixture.cases) {
  test(`processedSql parity — ${c.name}`, () => {
    const { relationNames } = planRuns(
      c.sql,
      c.shareToken,
      fixture.separator,
      c.params,
    );
    const processed = buildProcessedSqlRelations(
      c.sql,
      relationNames,
      c.params,
      fixture.defaultMaxRows,
    );
    expect(processed).toBe(c.expectedProcessedSql);
  });

  test(`runs parity — ${c.name}`, () => {
    const { runs } = planRuns(c.sql, c.shareToken, fixture.separator, c.params);
    expect(runs).toEqual(c.expectedRuns);
  });

  test(`depMap parity — ${c.name}`, () => {
    const depMap = buildDepMap(c.sql, c.expectedQueryId);
    expect(depMap).toEqual(c.expectedDepMap);
  });
}
