// data-table.tsx — a dumb, presentational data-table primitive.
//
// Pure: props in, JSX out. No data fetching, no param store, no router. All
// view-state (which column is sorted, the active filters, which rows are
// selected) is OWNED BY THE CONSUMER and passed in as values + callbacks — the
// primitive only renders chrome (scroll container, sticky header, sortable
// header cells, optional per-column filter inputs, selectable rows) and routes
// clicks/edits back out.
//
// The scroll chrome reuses the kit's ScrollArea; filter inputs reuse the kit's
// Input. Cells are rendered by the consumer-supplied `renderCell` so value
// formatting (null/bigint/object) stays in the widget, not the chrome.
//
// This is the `DataTable` primitive adopted by the `sql-table` widget per
// spec/ui/ui-architecture.md §6.2 (dumb control in ui-kit; the widget keeps the
// defineComponent + SDK hooks as a thin binding wrapper).
//
// Optional grouped-row affordance: when the consumer passes `rowMeta` (one entry
// per row, by index), the first column gets a depth-proportional indent and an
// expand/collapse chevron for expandable rows, and expandable (group/parent) rows
// are rendered non-selectable. With `rowMeta` absent the table renders exactly as
// the flat, ungrouped primitive it has always been — the dumb-primitive contract
// is unchanged; the consumer still owns all (collapse) view-state.

import { ChevronDown, ChevronRight } from "./icons"
import { cn } from "./cn"
import { Input } from "./input"

export interface DataTableProps {
  /** Column keys, in render order. */
  columns: readonly string[]
  /** Row objects keyed by column. */
  rows: ReadonlyArray<Record<string, unknown>>
  /** Format a single cell value to a renderable string (consumer-owned). */
  renderCell: (value: unknown) => string

  // ---- sort (consumer-owned view state) ----
  /** Whether headers are clickable to sort. */
  sortable?: boolean
  /** The currently sorted column, or null. */
  sortKey?: string | null
  /** Sort direction for `sortKey`. */
  sortDir?: "asc" | "desc"
  /** Called with the column key when a sortable header is clicked. */
  onToggleSort?: (col: string) => void

  // ---- filter (consumer-owned view state) ----
  /** Whether a per-column filter input row is shown. */
  filterable?: boolean
  /** Current filter text per column. */
  filters?: Record<string, string>
  /** Called with (col, value) when a filter input changes. */
  onFilterChange?: (col: string, value: string) => void

  // ---- selection (consumer-owned view state) ----
  /** When true, rows are clickable and carry selectable/selected styling. */
  selectable?: boolean
  /** Predicate: is this row currently selected? */
  isRowSelected?: (row: Record<string, unknown>) => boolean
  /** Called with the row when a selectable row is clicked. */
  onRowClick?: (row: Record<string, unknown>) => void

  // ---- grouped rows (consumer-owned view state; optional) ----
  /**
   * Per-row display metadata, aligned to `rows` by index. When present, the
   * first column is indented by `depth` and expandable rows show a collapse
   * chevron; expandable rows are rendered non-selectable. Absent ⇒ flat
   * rendering (the original, unchanged behavior).
   */
  rowMeta?: ReadonlyArray<{ depth: number; expandable: boolean; expanded: boolean }>
  /** Called with the row index when a row's collapse chevron is clicked. */
  onToggleRow?: (index: number) => void

  className?: string
}

/**
 * Presentational data table. Renders a sticky-header, scrollable table whose
 * sort/filter/selection are entirely driven by the props above.
 */
export function DataTable({
  columns,
  rows,
  renderCell,
  sortable = false,
  sortKey = null,
  sortDir = "asc",
  onToggleSort,
  filterable = false,
  filters,
  onFilterChange,
  selectable = false,
  isRowSelected,
  onRowClick,
  rowMeta,
  onToggleRow,
  className,
}: DataTableProps) {
  return (
    <div
      data-slot="data-table"
      className={cn(
        // Scroll BOTH axes: max-h caps vertical, overflow-auto lets a wide table
        // (more columns than fit) scroll horizontally instead of clipping at
        // narrow widths (interaction-audit: tables must scroll, not clip).
        "max-h-[460px] w-full overflow-auto rounded-md border border-border",
        className,
      )}
    >
      <table className="w-max min-w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sortable && sortKey === col
              const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : ""
              return (
                <th
                  key={col}
                  onClick={sortable ? () => onToggleSort?.(col) : undefined}
                  aria-sort={
                    active
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cn(
                    "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground",
                    sortable && "cursor-pointer select-none",
                  )}
                >
                  {col}
                  {arrow}
                </th>
              )
            })}
          </tr>
          {filterable ? (
            <tr>
              {columns.map((col) => (
                <th key={col} className="bg-card px-2 py-1">
                  <Input
                    type="text"
                    value={filters?.[col] ?? ""}
                    placeholder="Filter…"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onFilterChange?.(col, e.target.value)}
                    className="h-7 text-xs"
                  />
                </th>
              ))}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const meta = rowMeta?.[ri]
            // Expandable (group/parent) rows are never selectable; only leaf
            // rows keep the original selection behavior.
            const rowSelectable = selectable && !meta?.expandable
            const selected = rowSelectable && !!isRowSelected?.(row)
            return (
              <tr
                key={ri}
                onClick={rowSelectable ? () => onRowClick?.(row) : undefined}
                aria-selected={rowSelectable ? selected : undefined}
                className={cn(
                  "transition-colors",
                  "even:bg-muted/30 hover:bg-accent/50",
                  rowSelectable && "cursor-pointer select-none",
                  selected && "bg-primary/15 hover:bg-primary/15",
                )}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col}
                    className="whitespace-nowrap border-b border-border px-3 py-2 font-mono tabular-nums text-foreground"
                  >
                    {ci === 0 && meta ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          style={{ width: meta.depth * 16 }}
                          className="inline-block shrink-0"
                        />
                        {meta.expandable ? (
                          <button
                            type="button"
                            aria-expanded={meta.expanded}
                            aria-label={meta.expanded ? "Collapse row" : "Expand row"}
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleRow?.(ri)
                            }}
                            className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0"
                          >
                            {meta.expanded ? (
                              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        ) : (
                          <span aria-hidden className="inline-block size-4 shrink-0" />
                        )}
                        {renderCell(row[col])}
                      </span>
                    ) : (
                      renderCell(row[col])
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
