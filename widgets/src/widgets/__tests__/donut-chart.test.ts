import { describe, it, expect } from "vitest";

import {
  legendRowLayout,
  LEGEND_ROW_HEIGHT,
} from "../donut-chart";

// These assert the COMPUTED legend geometry — the bug was that legend rows had
// no per-row vertical position and collapsed onto one baseline (labels painted
// over each other: "NPR" + next row → "NPRal"). The fix lays each row out at
// `top = index * rowHeight`, so adjacent rows never share a baseline.
describe("donut-chart legendRowLayout", () => {
  const PALETTE = ["#aaa", "#bbb", "#ccc"];

  it("gives every row its own non-overlapping vertical slot", () => {
    const rows = legendRowLayout(
      [
        { label: "NPR" },
        { label: "The Washington Post" },
        { label: "Reuters" },
      ],
      PALETTE,
    );

    // One row per entry, in order.
    expect(rows.map((r) => r.label)).toEqual([
      "NPR",
      "The Washington Post",
      "Reuters",
    ]);

    // Tops are strictly increasing by exactly one row-height — no two rows
    // share a baseline (the overlap/garble bug).
    expect(rows.map((r) => r.top)).toEqual([
      0,
      LEGEND_ROW_HEIGHT,
      2 * LEGEND_ROW_HEIGHT,
    ]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].top - rows[i - 1].top).toBe(LEGEND_ROW_HEIGHT);
      expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].top + LEGEND_ROW_HEIGHT);
    }
  });

  it("assigns palette colors cyclically per row", () => {
    const rows = legendRowLayout(
      [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }],
      PALETTE,
    );
    expect(rows.map((r) => r.color)).toEqual(["#aaa", "#bbb", "#ccc", "#aaa"]);
  });

  it("honors a custom row height", () => {
    const rows = legendRowLayout([{ label: "a" }, { label: "b" }], PALETTE, 24);
    expect(rows.map((r) => r.top)).toEqual([0, 24]);
  });

  it("returns an empty layout for no entries", () => {
    expect(legendRowLayout([], PALETTE)).toEqual([]);
  });
});
