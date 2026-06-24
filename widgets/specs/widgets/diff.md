# `diff`

> Show a textual diff as colored +/- lines — e.g. the change between two markdown spec versions.

## Why
A diff renderer for showing what changed between two pieces of text — built for
**spec review** (the change between two markdown spec versions), but useful for any
before/after text. It is an **OpenFused-owned primitive** (no app parity).

The rendering is the shared `DiffView` from `@fusedio/widgets`
(`src/diff-view.tsx`) — the **same** renderer a consuming control-plane app's spec-review
thread uses (that consumer is now external — Flow, `fusedio/flow`, where it is fed by a
`DiffForPath` → `api.projectDiff` path). One diff implementation, two surfaces.

## Expectation
Two input modes (provide one):

- **`before` + `after`** (the common case): a line-level diff is computed in the
  widget via a longest-common-subsequence walk (no dependency). Each line is
  classified `ctx` (unchanged), `del` (only in `before`), or `add` (only in
  `after`); deletions precede additions at a divergence (git-like). A single
  trailing newline difference is ignored. Computed lines render with a `+`/`-`/` `
  gutter.
- **`diff`**: a precomputed unified-diff string (git format) rendered **as-is**.
  Line coloring: `+`→add, `-`→del, `@@`→hunk; `diff --git`/`index`/`+++`/`---`
  file headers are muted **meta** (NOT add/del). No synthetic gutter (the markers
  are already in the text).

Other behaviour:
- A whitespace-only `diff`, or a `before`/`after` pair with no changes, renders
  `"No changes."`.
- Optional `oldLabel`/`newLabel` render a header (`oldLabel` struck through, then
  `→ newLabel`).
- Styling is theme-portable: `.ofw-diff` (widget.css) tints add/del rows with
  translucent green/red that read on both the dark widget surface and a consuming
  host's task thread; text color is inherited.
- Not data-bound, not an input.
- Renders everywhere.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `before` | `string` | — | Original text; diffed line-by-line against `after`. |
| `after` | `string` | — | New text; diffed line-by-line against `before`. |
| `diff` | `string` | — | Precomputed unified-diff string (git format); rendered as-is. Use INSTEAD of before/after. |
| `oldLabel` | `string` | — | Optional label for the original side (header). |
| `newLabel` | `string` | — | Optional label for the new side (header). |
| `style` | `string` | — | Optional inline CSS merged over `.ofw-diff` defaults. |

- **Data-bound:** no.
- **Writes param:** no.

## Notes
- Uses SDK primitives only (`parseStyle`, `defineComponent`, `ComponentRenderProps`)
  plus the shared `DiffView`. `computeLineDiff` / `classifyUnifiedLine` are exported
  from `diff-view.tsx` and unit-tested directly.
- `DiffView` imports no CSS itself; consumers must have `widget.css` loaded (a consuming
  host loads it globally in its entry, `main.tsx`).
