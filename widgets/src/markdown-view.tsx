// markdown-view.tsx — the ONE Markdown renderer shared by the `markdown` JSON-UI
// widget (widgets/markdown.tsx) and the app task thread
// (app/src/ui/components/Markdown.tsx). Full-consolidation: there is a single
// implementation of "render markdown" in the repo and both surfaces import it.
//
// Pure + presentational: text in, React out, no data/transport. Styling lives in
// widget.css under `.ofw-md` and is THEME-PORTABLE — it inherits the host's text
// `color` (so it reads on the dark widget card AND the light/dark app thread) and
// only sets spacing, structure, and translucent accents. Consumers must have
// widget.css loaded (the app imports it globally in main.tsx; the bundle/app
// already do for widget rendering).
//
// This module intentionally does NOT import any .css (the generator loads it
// transitively via the widget catalog under node/tsx, which cannot parse CSS).
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownViewProps {
  /** Markdown source to render. */
  text: string;
  /** Extra class(es) merged onto the `.ofw-md` wrapper. */
  className?: string;
  /** Optional inline style merged onto the wrapper. */
  style?: React.CSSProperties;
}

/**
 * Render a markdown string. Links open in a new tab; everything else uses
 * react-markdown defaults (no raw HTML — safe by default, matching the trust
 * model of the rest of the catalog).
 */
export function MarkdownView({ text, className, style }: MarkdownViewProps) {
  const cls = className ? `ofw-md ${className}` : "ofw-md";
  return (
    <div className={cls} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...p }) => <a target="_blank" rel="noreferrer" {...p} />,
        }}
      >
        {text ?? ""}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
