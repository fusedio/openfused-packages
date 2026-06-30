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
import { CodeBlock } from "./components/CodeBlock";

// A fenced code block arrives as <pre><code class="language-xxx">…</code></pre>.
// Overriding `pre` (not `code`) keeps INLINE code on react-markdown's default
// `code` renderer and routes only block code through the shared CodeBlock, so
// fenced blocks get syntax highlighting. CodeBlock pulls shiki in lazily at
// render time, so importing this module under node/tsx (the catalog generator)
// stays highlighter-free.
function FencedPre({ children, ...rest }: React.ComponentPropsWithoutRef<"pre">) {
  const codeEl = React.Children.toArray(children).find(
    (c): c is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
      React.isValidElement(c) && c.type === "code",
  );
  if (codeEl) {
    const lang = /language-([\w-]+)/.exec(codeEl.props.className ?? "")?.[1];
    const text = String(codeEl.props.children ?? "").replace(/\n$/, "");
    return <CodeBlock code={text} lang={lang} />;
  }
  return <pre {...rest}>{children}</pre>;
}

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
          pre: ({ node: _node, ...p }) => <FencedPre {...p} />,
        }}
      >
        {text ?? ""}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
