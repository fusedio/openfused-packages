// _options.ts — shared option model + normalization for the selection inputs
// (`dropdown`, `checkbox-group`).
//
// Both selection inputs resolve their options the SAME way: a static
// `options: {value, label?}[]` list, or a DuckDB `sql` query whose rows carry
// NAMED `value`/`label` columns (case-insensitive). The normalization is the
// app's (DropdownPropsSchema's `sanitizeOptions` / `normalizeSqlRow`), and is
// intentionally identical across the two widgets — so it lives here once
// rather than being duplicated per widget (spec/widgets/dropdown.md,
// spec/widgets/checkbox-group.md both point at "reuse `normalizeSqlRow`").

/** A resolved option: a trimmed string value plus a non-empty display label. */
export interface ResolvedOption {
  value: string;
  label: string;
}

/**
 * Sanitize static options (app sanitizeOptions, string-value subset): drop
 * entries whose value is empty/null; label defaults to the (trimmed) value.
 */
export function sanitizeStaticOptions(
  opts: Array<{ value: string; label?: string }> | undefined,
): ResolvedOption[] {
  if (!opts || !Array.isArray(opts)) return [];
  const result: ResolvedOption[] = [];
  for (const o of opts) {
    if (o?.value == null) continue;
    const value = String(o.value).trim();
    if (value === "") continue;
    const label = o.label != null ? String(o.label).trim() : "";
    result.push({ value, label: label || value });
  }
  return result;
}

/**
 * Normalize a SQL result row to {value, label} by NAMED columns (app
 * normalizeSqlRow): value/Value/VALUE and label/Label/LABEL, case-insensitive.
 * label falls back to value; rows with empty/null value are dropped (→ null).
 */
export function normalizeSqlRow(
  row: Record<string, unknown>,
): ResolvedOption | null {
  const rawValue = row.value ?? row.Value ?? row.VALUE;
  const rawLabel = row.label ?? row.Label ?? row.LABEL;
  const label = rawLabel ?? rawValue;

  const value = rawValue != null ? String(rawValue).trim() : "";
  const labelStr = label != null ? String(label).trim() : "";

  if (value === "") return null;
  return { value, label: labelStr || value };
}
