// sql-table-grouping.test.ts — pure-function spec for the grouping engine.
// No mocks; just import and call.
import { describe, expect, it } from "vitest";
import {
  buildGroupedRows,
  type GroupingViewState,
} from "../sql-table-grouping";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Multi-level group keys are joined by the ASCII unit separator U+001F (so
// values containing spaces can't collide across levels). Single-level keys are
// the bare value.
const KEY_SEP = "";

const FLAT_VS: GroupingViewState = {
  collapsedKeys: new Set(),
  sortKey: null,
  sortDir: "asc",
  sortable: false,
};

function vs(overrides: Partial<GroupingViewState> = {}): GroupingViewState {
  return { ...FLAT_VS, ...overrides };
}

/** Locate a header row at a given depth whose `col` equals `value`. */
function findHeader(
  r: ReturnType<typeof buildGroupedRows>,
  col: string,
  value: unknown,
  depth: number,
): Record<string, unknown> | undefined {
  const i = r.rows.findIndex(
    (row, idx) =>
      row[col] === value && r.meta[idx].depth === depth && r.meta[idx].expandable,
  );
  return i === -1 ? undefined : r.rows[i];
}

// ---------------------------------------------------------------------------
// Ungrouped / degenerate passthrough
// ---------------------------------------------------------------------------

describe("passthrough: ungrouped input", () => {
  const rows = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];

  it("returns rows unchanged with flat meta when groupBy is empty", () => {
    const r = buildGroupedRows(rows, { groupBy: [] }, FLAT_VS);
    expect(r.rows).toEqual(rows);
    expect(r.meta.every((m) => m.depth === 0 && !m.expandable)).toBe(true);
  });

  it("returns empty result for empty input", () => {
    const r = buildGroupedRows([], { groupBy: ["name"] }, FLAT_VS);
    expect(r).toEqual({ rows: [], meta: [], keys: [] });
  });
});

// ---------------------------------------------------------------------------
// Group-by single column
// ---------------------------------------------------------------------------

describe("groupBy: single column", () => {
  const rows = [
    { dept: "Eng", name: "Alice", salary: 100 },
    { dept: "Eng", name: "Bob", salary: 200 },
    { dept: "HR", name: "Carol", salary: 150 },
  ];

  it("produces one synthetic header per distinct value followed by leaf rows", () => {
    const r = buildGroupedRows(rows, { groupBy: ["dept"] }, FLAT_VS);
    // Two headers (Eng, HR) + 3 leaves = 5 rows
    expect(r.rows).toHaveLength(5);
    expect(r.meta[0]).toEqual({ depth: 0, expandable: true, expanded: true });
    expect(r.meta[1]).toEqual({ depth: 1, expandable: false, expanded: false });
    expect(r.meta[2]).toEqual({ depth: 1, expandable: false, expanded: false });
    expect(r.meta[3]).toEqual({ depth: 0, expandable: true, expanded: true });
    expect(r.meta[4]).toEqual({ depth: 1, expandable: false, expanded: false });
  });

  it("header row carries the group column value; other columns undefined", () => {
    const r = buildGroupedRows(rows, { groupBy: ["dept"] }, FLAT_VS);
    const engHeader = r.rows[0];
    expect(engHeader["dept"]).toBe("Eng");
    // non-group, non-aggregate columns are absent / undefined on header
    expect(engHeader["name"]).toBeUndefined();
  });

  it("keys contains the group key for each header, empty string for leaves", () => {
    const r = buildGroupedRows(rows, { groupBy: ["dept"] }, FLAT_VS);
    expect(r.keys[0]).toBe("Eng");
    expect(r.keys[1]).toBe("");
    expect(r.keys[3]).toBe("HR");
  });
});

// ---------------------------------------------------------------------------
// Group-by nested (two columns)
// ---------------------------------------------------------------------------

describe("groupBy: nested two columns", () => {
  const rows = [
    { dept: "Eng", team: "Frontend", name: "Alice", salary: 100 },
    { dept: "Eng", team: "Backend", name: "Bob", salary: 200 },
    { dept: "Eng", team: "Backend", name: "Carol", salary: 150 },
    { dept: "HR", team: "Recruiting", name: "Dave", salary: 120 },
  ];

  it("produces depth-0 (dept) and depth-1 (team) headers, depth-2 leaves", () => {
    const r = buildGroupedRows(rows, { groupBy: ["dept", "team"] }, FLAT_VS);
    const depths = r.meta.map((m) => m.depth);
    // Eng (0) → Frontend (1) → Alice (2), Backend (1) → Bob (2), Carol (2)
    // HR (0) → Recruiting (1) → Dave (2)
    expect(depths).toEqual([0, 1, 2, 1, 2, 2, 0, 1, 2]);
  });

  it("keys track nested paths (NUL-joined)", () => {
    const r = buildGroupedRows(rows, { groupBy: ["dept", "team"] }, FLAT_VS);
    // depth-0 key = "Eng", depth-1 key = "Eng<NUL>Frontend"
    expect(r.keys[0]).toBe("Eng");
    expect(r.keys[1]).toBe("Eng" + KEY_SEP + "Frontend");
    expect(r.keys[3]).toBe("Eng" + KEY_SEP + "Backend");
    expect(r.keys[6]).toBe("HR");
  });

  it("multi-level keys do not collide when group values contain spaces", () => {
    // Space-joined keys WOULD have collided: both ["North","West Side"] and
    // ["North West","Side"] yield "North West Side". NUL-join keeps them distinct.
    const collidey = [
      { region: "North", city: "West Side", name: "a" },
      { region: "North West", city: "Side", name: "b" },
    ];
    const r = buildGroupedRows(collidey, { groupBy: ["region", "city"] }, FLAT_VS);
    const depth1Keys = r.keys.filter((_, i) => r.meta[i].depth === 1);
    expect(depth1Keys).toHaveLength(2);
    expect(depth1Keys[0]).not.toBe(depth1Keys[1]);

    // Collapsing one depth-1 group must NOT collapse the other.
    const r2 = buildGroupedRows(
      collidey,
      { groupBy: ["region", "city"] },
      vs({ collapsedKeys: new Set([depth1Keys[0]]) }),
    );
    const collapsed = r2.meta.find((_, i) => r2.keys[i] === depth1Keys[0]);
    const other = r2.meta.find((_, i) => r2.keys[i] === depth1Keys[1]);
    expect(collapsed?.expanded).toBe(false);
    expect(other?.expanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe("aggregates: sum / count / avg over descendant leaves only", () => {
  const rows = [
    { dept: "Eng", salary: 100 },
    { dept: "Eng", salary: 200 },
    { dept: "HR", salary: 150 },
  ];

  it("sum: adds numeric values from leaves under each header", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ aggregates: { salary: "sum" } }),
    );
    expect(findHeader(r, "dept", "Eng", 0)?.["salary"]).toBe(300);
    expect(findHeader(r, "dept", "HR", 0)?.["salary"]).toBe(150);
  });

  it("count: counts leaf rows (not numeric sum)", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ aggregates: { salary: "count" } }),
    );
    expect(findHeader(r, "dept", "Eng", 0)?.["salary"]).toBe(2); // Eng has 2
    expect(findHeader(r, "dept", "HR", 0)?.["salary"]).toBe(1); // HR has 1
  });

  it("nested groupBy: depth-0 header sums over ALL descendant leaves across sub-groups", () => {
    const nested = [
      { dept: "Eng", team: "Frontend", salary: 100 },
      { dept: "Eng", team: "Backend", salary: 200 },
      { dept: "Eng", team: "Backend", salary: 50 },
      { dept: "HR", team: "Recruiting", salary: 150 },
    ];
    const r = buildGroupedRows(
      nested,
      { groupBy: ["dept", "team"] },
      vs({ aggregates: { salary: "sum" } }),
    );
    // depth-0 Eng header rolls up every team's leaves: 100 + 200 + 50 = 350
    expect(findHeader(r, "dept", "Eng", 0)?.["salary"]).toBe(350);
    // depth-1 Backend header sums only its own leaves: 200 + 50 = 250
    expect(findHeader(r, "team", "Backend", 1)?.["salary"]).toBe(250);
    expect(findHeader(r, "dept", "HR", 0)?.["salary"]).toBe(150);
  });

  it("avg: averages the numeric values", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ aggregates: { salary: "avg" } }),
    );
    expect(r.rows[0]["salary"]).toBe(150); // (100+200)/2
  });

  it("coerces string numbers and bigints", () => {
    const mixedRows = [
      { dept: "Eng", salary: "100" },
      { dept: "Eng", salary: 200n },
    ];
    const r = buildGroupedRows(
      mixedRows,
      { groupBy: ["dept"] },
      vs({ aggregates: { salary: "sum" } }),
    );
    expect(r.rows[0]["salary"]).toBe(300);
  });

  it("non-aggregate columns are undefined on synthetic header rows", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ aggregates: { salary: "sum" } }),
    );
    // 'salary' is aggregated so it will be present; any other column won't be
    const engHeader = r.rows[0];
    expect("name" in engHeader ? engHeader["name"] : undefined).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Master-detail (adjacency list)
// ---------------------------------------------------------------------------

describe("master-detail: idColumn + parentColumn", () => {
  const rows = [
    { id: "1", parent: null, name: "Root A" },
    { id: "2", parent: "1", name: "Child of A" },
    { id: "3", parent: "2", name: "Grandchild" },
    { id: "4", parent: null, name: "Root B" },
  ];
  const cfg = { idColumn: "id", parentColumn: "parent" };

  it("adjacency: roots at depth 0, children increment depth", () => {
    const r = buildGroupedRows(rows, cfg, FLAT_VS);
    expect(r.meta[0]).toEqual({ depth: 0, expandable: true, expanded: true }); // Root A
    expect(r.meta[1]).toEqual({ depth: 1, expandable: true, expanded: true }); // Child of A
    expect(r.meta[2]).toEqual({ depth: 2, expandable: false, expanded: false }); // Grandchild
    expect(r.meta[3]).toEqual({ depth: 0, expandable: false, expanded: false }); // Root B
  });

  it("rows appear in DFS order: Root A → Child → Grandchild → Root B", () => {
    const r = buildGroupedRows(rows, cfg, FLAT_VS);
    expect(r.rows.map((row) => row["id"])).toEqual(["1", "2", "3", "4"]);
  });

  it("root detection: null parent, empty string parent, unmatched parent", () => {
    const tricky = [
      { id: "x", parent: null, name: "null-parent root" },
      { id: "y", parent: "", name: "empty-parent root" },
      { id: "z", parent: "nonexistent", name: "unmatched root" },
    ];
    const r = buildGroupedRows(tricky, cfg, FLAT_VS);
    expect(r.meta.every((m) => m.depth === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Collapse behaviour
// ---------------------------------------------------------------------------

describe("collapse: collapsedKeys omits subtree", () => {
  const rows = [
    { dept: "Eng", name: "Alice" },
    { dept: "Eng", name: "Bob" },
    { dept: "HR", name: "Carol" },
  ];

  it("collapsing a group key removes its children from output", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ collapsedKeys: new Set(["Eng"]) }),
    );
    // Header for Eng (1) + header for HR (1) + Carol (1) = 3 rows; Alice/Bob excluded
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((row) => row["name"])).not.toContain("Alice");
    expect(r.rows.map((row) => row["name"])).not.toContain("Bob");
  });

  it("collapsed node has expanded:false in meta", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ collapsedKeys: new Set(["Eng"]) }),
    );
    const engMeta = r.meta[0];
    expect(engMeta.expanded).toBe(false);
    expect(engMeta.expandable).toBe(true);
  });

  it("collapsing a master-detail node removes its subtree", () => {
    const mdRows = [
      { id: "1", parent: null, name: "Root" },
      { id: "2", parent: "1", name: "Child" },
      { id: "3", parent: "2", name: "Grandchild" },
    ];
    const r = buildGroupedRows(
      mdRows,
      { idColumn: "id", parentColumn: "parent" },
      vs({ collapsedKeys: new Set(["1"]) }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]["id"]).toBe("1");
    expect(r.meta[0].expanded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Within-group sort
// ---------------------------------------------------------------------------

describe("sort: siblings ordered within parent, hierarchy preserved", () => {
  const rows = [
    { dept: "Eng", salary: 200, name: "Bob" },
    { dept: "Eng", salary: 100, name: "Alice" },
    { dept: "HR", salary: 150, name: "Carol" },
  ];

  it("sorts leaf siblings by numeric sortKey asc within each group", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ sortKey: "salary", sortDir: "asc", sortable: true }),
    );
    // Eng header, then Alice (100), then Bob (200)
    const engRows = r.rows.slice(1, 3); // two Eng leaves
    expect(engRows[0]["name"]).toBe("Alice");
    expect(engRows[1]["name"]).toBe("Bob");
  });

  it("sorts leaf siblings desc", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ sortKey: "salary", sortDir: "desc", sortable: true }),
    );
    const engRows = r.rows.slice(1, 3);
    expect(engRows[0]["name"]).toBe("Bob");
    expect(engRows[1]["name"]).toBe("Alice");
  });

  it("group headers stay adjacent to their children despite sort", () => {
    const r = buildGroupedRows(
      rows,
      { groupBy: ["dept"] },
      vs({ sortKey: "salary", sortDir: "asc", sortable: true }),
    );
    // meta must alternate: depth 0 header then depth 1 leaves
    expect(r.meta[0].depth).toBe(0);
    expect(r.meta[1].depth).toBe(1);
    expect(r.meta[2].depth).toBe(1);
    expect(r.meta[3].depth).toBe(0);
    expect(r.meta[4].depth).toBe(1);
  });

  it("localeCompare with numeric:true for string values", () => {
    const strRows = [
      { cat: "A", val: "10" },
      { cat: "A", val: "9" },
      { cat: "A", val: "100" },
    ];
    const r = buildGroupedRows(
      strRows,
      { groupBy: ["cat"] },
      vs({ sortKey: "val", sortDir: "asc", sortable: true }),
    );
    const leaves = r.rows.slice(1).map((row) => row["val"]);
    expect(leaves).toEqual(["9", "10", "100"]);
  });

  it("master-detail siblings sorted within parent", () => {
    const mdRows = [
      { id: "1", parent: null, name: "Root", val: 5 },
      { id: "3", parent: "1", name: "C", val: 30 },
      { id: "2", parent: "1", name: "B", val: 10 },
    ];
    const r = buildGroupedRows(
      mdRows,
      { idColumn: "id", parentColumn: "parent" },
      vs({ sortKey: "val", sortDir: "asc", sortable: true }),
    );
    expect(r.rows[1]["id"]).toBe("2"); // B before C
    expect(r.rows[2]["id"]).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

describe("malformed input: robustness", () => {
  it("self-referencing parent treated as root (no infinite loop)", () => {
    const rows = [{ id: "1", parent: "1", name: "Self" }];
    const r = buildGroupedRows(
      rows,
      { idColumn: "id", parentColumn: "parent" },
      FLAT_VS,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.meta[0].depth).toBe(0);
  });

  it("cycle via visited set: no infinite loop", () => {
    // A → B → A cycle (B's parent is A, but A's parent is B — one will be root via unmatched)
    const rows = [
      { id: "A", parent: "B", name: "A" },
      { id: "B", parent: "A", name: "B" },
    ];
    // A's parent is B which exists, B's parent is A which exists.
    // Both have each other as parent → one should appear as root due to processing order.
    // Key guarantee: no infinite loop.
    expect(() =>
      buildGroupedRows(rows, { idColumn: "id", parentColumn: "parent" }, FLAT_VS),
    ).not.toThrow();
  });

  it("parent pointing at non-existent id treated as root", () => {
    const rows = [{ id: "1", parent: "ghost", name: "Orphan" }];
    const r = buildGroupedRows(
      rows,
      { idColumn: "id", parentColumn: "parent" },
      FLAT_VS,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.meta[0].depth).toBe(0);
  });
});
