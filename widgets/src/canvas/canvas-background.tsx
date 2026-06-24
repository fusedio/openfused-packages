// Non-interactive canvas background for the JSON-UI canvas. Ported from the
// app's mcp-host `canvas/canvas-background.tsx`; re-expressed in openfused's
// `--ofw-*` tokens.
//
// CRITICAL (PINNED): guard against a NaN/∞ viewport transform — render *no*
// pattern until `transform` is finite and `zoom > 0`. On an unmeasured container
// ReactFlow computes `x % (gap * zoom)` against NaN/Infinity and emits thousands
// of `<pattern>`/`<path>` SVG errors per second. Selecting a derived boolean
// keeps re-renders limited to validity flips, not every pan/zoom frame.

import { memo } from "react";

import { Background, BackgroundVariant, useStore } from "@xyflow/react";

export interface CanvasBackgroundProps {
  /** Background style. Defaults to "dots". */
  variant?: "dots" | "lines" | "none";
}

// Dot-grid tone: --ofw-text (off-white) at low opacity, mixed so it reads as a
// faint field texture against --ofw-bg, never as a solid dot.
const DOT_COLOR = "color-mix(in oklab, var(--ofw-text) 8%, transparent)";
// Faint line grid.
const LINE_COLOR = "color-mix(in oklab, var(--ofw-text) 10%, transparent)";

const DOT_GAP = 50;
const DOT_SIZE = 8;
const LINE_GAP = 500;
const LINE_SIZE = 25;

/**
 * Layered, non-interactive canvas background. Returns `null` until the viewport
 * transform is finite and `zoom > 0` (the NaN/∞ guard).
 */
export const CanvasBackground = memo(function CanvasBackground({
  variant = "dots",
}: CanvasBackgroundProps) {
  // Subscribe to the full transform but collapse to a single validity boolean so
  // this only re-renders when finite-ness flips, not on every pan/zoom frame.
  const isViewportValid = useStore((s) => {
    const [x, y, zoom] = s.transform;
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(zoom) &&
      zoom > 0
    );
  });

  if (variant === "none") return null;
  if (!isViewportValid) return null;

  return (
    <>
      <Background
        id="canvas-dots"
        variant={BackgroundVariant.Dots}
        gap={DOT_GAP}
        size={DOT_SIZE}
        color={DOT_COLOR}
      />
      {variant === "lines" ? (
        <Background
          id="canvas-lines"
          variant={BackgroundVariant.Lines}
          gap={LINE_GAP}
          size={LINE_SIZE}
          color={LINE_COLOR}
        />
      ) : null}
    </>
  );
});
