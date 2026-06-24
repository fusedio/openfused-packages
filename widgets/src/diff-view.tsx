// diff-view.tsx — the ONE diff renderer shared by the `diff` JSON-UI widget
// (widgets/diff.tsx) and the app task thread
// (app/src/ui/components/DiffRenderer.tsx). Full-consolidation: a single
// implementation of "show a diff" in the repo.
//
// Two input modes:
//   • before + after  → a line-level diff is computed here (LCS, no dependency),
//     the common case for the `diff` widget ("diff of two markdown specs").
//   • diff            → a precomputed unified-diff string (git format) is rendered
//     as-is with +/- coloring (the app spec-review path: api.projectDiff()).
//
// Pure + presentational. Styling lives in widget.css under `.ofw-diff` and is
// THEME-PORTABLE: add/del rows use translucent green/red tints that read on both
// the dark widget surface and the app thread; text color is inherited. No .css is
// imported here (the generator loads this module under node/tsx via the catalog).
import * as React from "react";

export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Line-level diff of `before` vs `after` via a longest-common-subsequence walk.
 * Returns `ctx` (unchanged), `del` (only in before), and `add` (only in after)
 * lines in document order. Deterministic; deletions are emitted before additions
 * at a divergence (git-like).
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.length ? before.replace(/\n$/, "").split("\n") : [];
  const b = after.length ? after.replace(/\n$/, "").split("\n") : [];
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Classify one line of a git unified-diff string. */
export function classifyUnifiedLine(line: string): DiffLineKind {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("+++") ||
    line.startsWith("---")
  )
    return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

function parseUnified(diff: string): DiffLine[] {
  return diff
    .replace(/\n$/, "")
    .split("\n")
    .map((text) => ({ kind: classifyUnifiedLine(text), text }));
}

const GUTTER: Record<DiffLineKind, string> = {
  add: "+",
  del: "-",
  ctx: " ",
  hunk: " ",
  meta: " ",
};

export interface DiffViewProps {
  /** Original text — diffed line-by-line against `after`. */
  before?: string;
  /** New text — diffed line-by-line against `before`. */
  after?: string;
  /** Precomputed unified-diff string (git format). Use INSTEAD of before/after. */
  diff?: string;
  /** Optional label for the original side (shown in the header). */
  oldLabel?: string;
  /** Optional label for the new side (shown in the header). */
  newLabel?: string;
  /** Extra class(es) merged onto the `.ofw-diff` wrapper. */
  className?: string;
  /** Optional inline style merged onto the wrapper. */
  style?: React.CSSProperties;
}

/**
 * Render a diff. When `diff` (a unified-diff string) is given it is rendered
 * as-is; otherwise a line diff of `before`/`after` is computed. A whitespace-only
 * diff or a no-change before/after pair renders "No changes.".
 */
export function DiffView({
  before,
  after,
  diff,
  oldLabel,
  newLabel,
  className,
  style,
}: DiffViewProps) {
  const cls = className ? `ofw-diff ${className}` : "ofw-diff";
  const unified = typeof diff === "string";
  const lines = unified ? parseUnified(diff) : computeLineDiff(before ?? "", after ?? "");
  const hasChange = lines.some((l) => l.kind === "add" || l.kind === "del");

  if (unified ? !diff.trim() : !hasChange) {
    return (
      <div className={cls} style={style}>
        <div className="ofw-diff__empty">No changes.</div>
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      {(oldLabel || newLabel) && (
        <div className="ofw-diff__header">
          {oldLabel && <span className="ofw-diff__label ofw-diff__label--old">{oldLabel}</span>}
          {oldLabel && newLabel && <span className="ofw-diff__arrow">→</span>}
          {newLabel && <span className="ofw-diff__label ofw-diff__label--new">{newLabel}</span>}
        </div>
      )}
      <pre className="ofw-diff__body">
        {lines.map((l, idx) => (
          <div key={idx} className={`ofw-diff__line ofw-diff__line--${l.kind}`}>
            {!unified && <span className="ofw-diff__gutter">{GUTTER[l.kind]}</span>}
            <span className="ofw-diff__text">{l.text || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export default DiffView;
