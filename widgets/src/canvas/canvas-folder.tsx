/**
 * Folder render components (view mode). A folder is a titled background region
 * that groups nodes — organizational only (it never affects dataflow). A tinted,
 * rounded region with a hue border, and a full-width label BAR sitting just above
 * the region's top edge (the renderer positions the title node above the box).
 * Rendered as two ReactFlow nodes (region behind edges, title above) so the
 * label is never occluded (B-CANVAS-FOLDER-02). The region is non-interactive;
 * the title bar is a collapse/expand toggle when the renderer passes
 * `onToggleCollapsed` (ephemeral view state — never persisted).
 *
 * Ported from the app's mcp-host `canvas/canvas-folder.tsx`; re-expressed in
 * openfused's tokens. An optional `color` key ("chart-1".."chart-N", or a
 * "series-N" key) selects a hue from openfused's `--ofw-series-*` palette;
 * default is a calm purple wash. This is a DECORATIVE region wash, NOT the
 * `--canvas-accent` signal.
 */
import type { CSSProperties } from "react";

import type { FolderBox } from "./canvas-folder-layout";

export interface FolderNodeData {
  box: FolderBox;
  memberCount?: number;
  /** Hidden members' display names — the collapsed region's summary chips. */
  memberTitles?: string[];
  /** Region width so the label bar can span it (set by the renderer). */
  width?: number;
  /**
   * Collapse/expand this folder (ephemeral view state, Workbench parity).
   * When provided, the title bar renders as a button with a disclosure chevron
   * and the collapsed region becomes a click-to-expand summary.
   */
  onToggleCollapsed?: (folderId: string) => void;
}

/** Most chips shown in a collapsed region before truncating to "+N". */
const MAX_SUMMARY_CHIPS = 4;

/** Height of the label bar; exported so the renderer can offset the title node above the box. */
export const FOLDER_TITLE_BAR_HEIGHT = 26;

// Default folder accent: a calm purple wash (decorative, not the signal accent).
const DEFAULT_HUE_RGB = "147, 112, 219";

interface FolderColors {
  regionBg: string;
  regionBorder: string;
  barBg: string;
  barText: string;
}

/**
 * Resolve a `color` key to a CSS hue var. The app used shadcn `--chart-N`; here
 * we map any "chart-N" / "series-N" / bare "N" key onto openfused's
 * `--ofw-series-N` palette. Unknown keys fall through to the var as-authored
 * (so `color: "ofw-accent"` works too).
 */
function hueVar(color: string): string {
  const m = color.match(/(?:chart-|series-)?(\d+)$/);
  if (m) return `var(--ofw-series-${m[1]})`;
  return `var(--${color})`;
}

function folderColors(color?: string): FolderColors {
  if (color) {
    const hue = hueVar(color);
    return {
      regionBg: `color-mix(in oklab, ${hue} 15%, transparent)`,
      regionBorder: `color-mix(in oklab, ${hue} 48%, transparent)`,
      barBg: `color-mix(in oklab, ${hue} 88%, transparent)`,
      barText: "#ffffff",
    };
  }
  return {
    regionBg: `rgba(${DEFAULT_HUE_RGB}, 0.14)`,
    regionBorder: `rgba(${DEFAULT_HUE_RGB}, 0.48)`,
    barBg: `rgba(${DEFAULT_HUE_RGB}, 0.92)`,
    barText: "#ffffff",
  };
}

export function CanvasFolderRegion({ data }: { data: FolderNodeData }) {
  const { box, memberTitles, onToggleCollapsed } = data;
  const c = folderColors(box.color);
  const collapsedInteractive = box.collapsed && !!onToggleCollapsed;
  const chips = box.collapsed ? memberTitles ?? [] : [];
  const shown = chips.slice(0, MAX_SUMMARY_CHIPS);
  const extra = chips.length - shown.length;
  return (
    <div
      className="canvas-folder-region"
      role={collapsedInteractive ? "button" : undefined}
      aria-label={
        collapsedInteractive
          ? `Expand section "${box.title ?? "Section"}"`
          : undefined
      }
      onClick={
        collapsedInteractive
          ? (e) => {
              e.stopPropagation();
              onToggleCollapsed!(box.id);
            }
          : undefined
      }
      style={{
        boxSizing: "border-box",
        width: box.width,
        height: box.height,
        background: c.regionBg,
        border: `1.5px solid ${c.regionBorder}`,
        borderRadius: 8,
        transition: "border 0.15s ease, background-color 0.15s ease",
        pointerEvents: collapsedInteractive ? "auto" : "none",
        cursor: collapsedInteractive ? "pointer" : undefined,
        // Collapsed: a quiet summary of what's tucked away, not an empty box.
        display: box.collapsed ? "flex" : undefined,
        alignItems: box.collapsed ? "center" : undefined,
        gap: box.collapsed ? 6 : undefined,
        padding: box.collapsed ? "0 12px" : undefined,
        overflow: box.collapsed ? "hidden" : undefined,
      }}
    >
      {shown.map((t, i) => (
        <span
          key={`${t}-${i}`}
          style={{
            flexShrink: 1,
            minWidth: 0,
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            lineHeight: "20px",
            padding: "0 8px",
            borderRadius: 999,
            background: "color-mix(in oklab, var(--ofw-text, #e7ecf3) 8%, transparent)",
            color: "var(--ofw-text-dim, #93a0b2)",
          }}
        >
          {t}
        </span>
      ))}
      {extra > 0 ? (
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            color: "var(--ofw-text-dim, #93a0b2)",
          }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
CanvasFolderRegion.displayName = "CanvasFolderRegion";

export function CanvasFolderTitle({ data }: { data: FolderNodeData }) {
  const { box, memberCount, width, onToggleCollapsed } = data;
  const c = folderColors(box.color);
  const label = box.title ?? "Section";
  const interactive = !!onToggleCollapsed;
  const barStyle: CSSProperties = {
    boxSizing: "border-box",
    width: width ?? box.width,
    height: FOLDER_TITLE_BAR_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 10px",
    border: "none",
    background: c.barBg,
    color: c.barText,
    font: "inherit",
    textAlign: "left",
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.45)",
    borderRadius: 6,
    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.28)",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: `${FOLDER_TITLE_BAR_HEIGHT}px`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    pointerEvents: interactive ? "auto" : "none",
    cursor: interactive ? "pointer" : undefined,
  };
  const children = (
    <>
      {interactive ? (
        <svg
          aria-hidden
          width={12}
          height={12}
          viewBox="0 0 12 12"
          style={{
            flexShrink: 0,
            transform: box.collapsed ? "rotate(-90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          <path
            d="M2.5 4.25 6 7.75l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      {box.collapsed && typeof memberCount === "number" ? (
        <span style={{ opacity: 0.8, fontWeight: 400 }}>({memberCount})</span>
      ) : null}
    </>
  );
  if (!interactive) {
    return (
      <div className="canvas-folder-title" style={barStyle}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="canvas-folder-title canvas-folder-title--toggle"
      style={barStyle}
      aria-expanded={!box.collapsed}
      aria-label={`${box.collapsed ? "Expand" : "Collapse"} section "${label}"`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleCollapsed!(box.id);
      }}
    >
      {children}
    </button>
  );
}
CanvasFolderTitle.displayName = "CanvasFolderTitle";
