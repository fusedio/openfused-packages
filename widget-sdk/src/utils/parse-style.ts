import type { CSSProperties } from "react";

/**
 * Parses a plain CSS string into a React CSSProperties object.
 * e.g. "color: red; font-size: 16px" → { color: "red", fontSize: "16px" }
 *
 * Pure — no bridge, no context. Used by every json-ui component that accepts
 * a `style` string prop, across all hosts (workbench, MCP, test harness).
 */
export function parseStyle(style: string | undefined): CSSProperties {
  if (!style) return {};
  const result: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const colonIdx = declaration.indexOf(":");
    if (colonIdx === -1) continue;
    const property = declaration.slice(0, colonIdx).trim();
    const value = declaration.slice(colonIdx + 1).trim();
    if (!property || !value) continue;
    const camelCase = property.replace(/-([a-z])/g, (_, l: string) =>
      l.toUpperCase(),
    );
    result[camelCase] = value;
  }
  return result as CSSProperties;
}
