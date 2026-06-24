// Canvas dataflow edge — a directed cubic-bezier line between two canvas nodes.
// Ported verbatim from the app's mcp-host `canvas/canvas-edge.tsx` (it already
// depends only on `@xyflow/react` + React — no app-internal imports). The CSS
// vars it reads (`--canvas-accent` / -ring / -soft) are defined inline on the
// canvas surface (widgets/canvas.tsx) so they resolve in the served bundle; the
// edge motion keyframes (`edgeDashFlow`, `pelletTravel`) live in canvas.css.
import React, { useMemo } from "react";

import {
  BaseEdge,
  EdgeProps,
  Position,
  getBezierPath,
  useStore,
} from "@xyflow/react";

/**
 * Per-edge `data` payload for {@link CanvasDataflowEdge}.
 *  - `directional` — `false` ⇒ bidirectional (a second arrowhead at the source
 *    end). Defaults to `true` (arrow at the target only).
 *  - `running` — `true` ⇒ the source node is broadcasting, so the edge lights up
 *    with the accent stroke, a marching dash, and a single travelling pellet.
 */
export interface CanvasDataflowEdgeData {
  directional?: boolean;
  running?: boolean;
  // Index signature keeps this assignable to @xyflow/react's `Edge["data"]`.
  [key: string]: unknown;
}

/** Idle stroke: a quiet, field-toned line (NOT the signal accent). */
const IDLE_STROKE = "color-mix(in oklab, var(--ofw-text) 22%, transparent)";

/** The single signal accent, used only when the edge is running. */
const RUNNING_STROKE = "var(--canvas-accent)";

/** Pellet travel duration. */
const PELLET_TRAVEL_MS = 750;

function CanvasDataflowEdgeComponent({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps): React.ReactElement {
  // Granular selector — re-render only when zoom changes, never on pan / unrelated
  // store updates (canvas-perf rule: avoid useViewport()).
  const zoom = useStore((s) => s.transform[2]);

  const running = Boolean(data?.running);
  // `directional` defaults true; only an explicit `false` makes it bidirectional.
  const directional =
    (data as CanvasDataflowEdgeData | undefined)?.directional !== false;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetPosition: targetPosition ?? Position.Left,
  });

  // Guard against a zero / NaN zoom (unmeasured container) before dividing.
  const zoomScale = zoom > 0 ? 1 / zoom : 1;

  // Zoom-independent screen sizing. Running edge is a touch heavier.
  const strokeWidth = Math.min(5, (running ? 2 : 1.5) * zoomScale);
  const pelletRadius = Math.min(18, Math.max(4, 7 * zoomScale));
  const stroke = running ? RUNNING_STROKE : IDLE_STROKE;

  // Self-contained arrow markers, coloured to the current edge state.
  const stateKey = running ? "run" : "idle";
  const markerEndId = `canvas-edge-arrow-${id}-${stateKey}-end`;
  const markerStartId = `canvas-edge-arrow-${id}-${stateKey}-start`;

  const edgeStyle = useMemo<React.CSSProperties>(
    () => ({
      stroke,
      strokeWidth,
      ...(running
        ? {
            strokeDasharray: "6 5",
            animation: "edgeDashFlow 1.5s linear infinite",
          }
        : null),
    }),
    [stroke, strokeWidth, running],
  );

  // The idle "outline" stroke (field colour, slightly wider) improves legibility
  // where edges cross.
  const outlineStyle = useMemo<React.CSSProperties>(
    () => ({
      stroke: "var(--ofw-bg)",
      strokeWidth: strokeWidth + Math.max(1, zoomScale),
      opacity: 0.8,
    }),
    [strokeWidth, zoomScale],
  );

  // Wide transparent stroke purely for pointer interaction (hover / click).
  const hitStrokeWidth = Math.max(14 * zoomScale, strokeWidth * 4);

  // Arrow marker geometry — small, filled, oriented along the path.
  const arrow = (
    <marker
      markerWidth={12}
      markerHeight={12}
      viewBox="-10 -10 20 20"
      orient="auto-start-reverse"
      refX={0}
      refY={0}
      markerUnits="strokeWidth"
    >
      <path d="M -5 -4 L 5 0 L -5 4 Z" fill={stroke} />
    </marker>
  );

  return (
    <>
      <defs>
        {React.cloneElement(arrow, { id: markerEndId })}
        {!directional && React.cloneElement(arrow, { id: markerStartId })}
      </defs>

      {/* Idle legibility outline beneath the visible stroke. */}
      <BaseEdge
        path={edgePath}
        style={outlineStyle}
        className="canvas-edge-outline"
      />

      {/* The visible bezier stroke with its arrowhead(s). */}
      <BaseEdge
        path={edgePath}
        style={edgeStyle}
        className="canvas-edge-path"
        markerEnd={`url(#${markerEndId})`}
        markerStart={!directional ? `url(#${markerStartId})` : undefined}
      />

      {/* Wide transparent hit target for reliable hover / click. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={hitStrokeWidth}
        strokeLinecap="round"
        style={{ pointerEvents: "stroke" }}
      />

      {/* Single data pellet travelling source→target while the edge is running. */}
      {running && (
        <circle
          key={`${id}-${source}-pellet`}
          r={pelletRadius}
          fill={RUNNING_STROKE}
          style={{
            offsetPath: `path('${edgePath}')`,
            animation: `pelletTravel ${PELLET_TRAVEL_MS}ms ease-in-out infinite`,
          }}
        />
      )}
    </>
  );
}

/** Memoised canvas dataflow edge. Drop into `edgeTypes={{ dataflow: CanvasDataflowEdge }}`. */
export const CanvasDataflowEdge = React.memo(CanvasDataflowEdgeComponent);

CanvasDataflowEdge.displayName = "CanvasDataflowEdge";
