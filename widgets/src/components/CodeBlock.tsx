// CodeBlock — the ONE shared source-code renderer for the repo. Syntax
// highlighting via shiki (VS Code's engine), themed for the dark surfaces Flow
// uses. Both the JSON-UI markdown widget (markdown-view fenced blocks) and the
// app's code surfaces (UDF source, file previews, the MCP config snippet,
// transcript I/O) import this so "render code" has a single implementation.
//
// Two deliberate constraints keep it safe to import anywhere:
//   1. NO css import and NO shiki import at module top. shiki is pulled in
//      lazily inside the highlight effect, so importing this module under
//      node/tsx (the widget-catalog generator walks markdown-view transitively)
//      never loads the highlighter or its grammars — the effect simply never
//      runs. Styling lives in widget.css under `.ofw-code` (loaded globally by
//      the app, and by the browser tests directly).
//   2. The first paint is always the raw code in a <pre><code> fallback, so the
//      text is visible immediately (and under SSR / no-JS / unknown language),
//      then swapped for the highlighted HTML once shiki resolves.
import * as React from "react";

// The shiki theme used across every surface. github-dark-default reads well on
// Flow's dark cards and panels; the wrapper makes shiki's own background
// transparent (see widget.css) so the code sits on the host surface.
const THEME = "github-dark-default";

// Grammars we preload into the singleton highlighter. Every language
// normalizeLang can return MUST appear here, or codeToHtml throws for it (the
// codeblock-lang test guards this invariant).
export const CODE_LANGS = [
  "python",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "sql",
  "bash",
  "yaml",
  "toml",
  "markdown",
] as const;

// File extension / alias → shiki grammar id. Tokens not present here are not
// highlighted (normalizeLang returns null → plain monospace fallback).
const LANG_BY_TOKEN: Record<string, (typeof CODE_LANGS)[number]> = {
  py: "python",
  python: "python",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  json5: "json",
  jsonc: "json",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  markdown: "markdown",
};

/**
 * Resolve a language token — a bare language name, a file extension, or a whole
 * filename (`main.py`) — to a shiki grammar id, or null when we don't highlight
 * it. Case- and whitespace-insensitive.
 */
export function normalizeLang(input?: string | null): (typeof CODE_LANGS)[number] | null {
  if (!input) return null;
  let token = input.trim().toLowerCase();
  if (token === "") return null;
  if (token.includes(".")) token = token.split(".").pop() ?? token;
  return LANG_BY_TOKEN[token] ?? null;
}

// Singleton highlighter, created on first use and shared across every CodeBlock
// (creating one per mount would reload the grammars each time). The JS regex
// engine avoids the wasm fetch the default oniguruma engine needs — one less
// async asset, and it handles every grammar in CODE_LANGS.
type Highlighter = { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string };
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [shiki, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki"),
        import("shiki/engine/javascript"),
      ]);
      return shiki.createHighlighter({
        themes: [THEME],
        langs: [...CODE_LANGS],
        engine: createJavaScriptRegexEngine(),
      }) as unknown as Promise<Highlighter>;
    })();
  }
  return highlighterPromise;
}

/**
 * Highlight `code` as `lang` (an already-normalized shiki grammar id, or null)
 * and return the shiki HTML, or null until it resolves / for no-lang / on error.
 * Shared by CodeBlock (read) and CodeEditor (the highlight layer behind the
 * textarea) so both use the one shiki singleton.
 */
export function useHighlightedHtml(code: string, lang: string | null): string | null {
  const [html, setHtml] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!lang) {
      setHtml(null);
      return;
    }
    let alive = true;
    getHighlighter()
      .then((hl) => {
        if (!alive) return;
        try {
          setHtml(hl.codeToHtml(code ?? "", { lang, theme: THEME }));
        } catch {
          if (alive) setHtml(null); // grammar miss → plain fallback, never blank
        }
      })
      .catch(() => {
        if (alive) setHtml(null); // highlighter failed to load → plain fallback
      });
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return html;
}

export interface CodeBlockProps {
  /** The source to render. */
  code: string;
  /** Language name, file extension, or filename. Unknown → no highlight. */
  lang?: string | null;
  /** Show a left line-number gutter (CSS counter on shiki's `.line` spans). */
  lineNumbers?: boolean;
  /** Extra class(es) merged onto the `.ofw-code` wrapper. */
  className?: string;
}

/**
 * Render source code highlighted with shiki, falling back to plain monospace
 * until the highlighter resolves (and for unknown languages or on error).
 */
export function CodeBlock({ code, lang, lineNumbers = false, className }: CodeBlockProps) {
  const resolved = normalizeLang(lang);
  const html = useHighlightedHtml(code, resolved);

  const cls = ["ofw-code", lineNumbers ? "ofw-code--numbered" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  if (html) {
    return <div className={cls} data-lang={resolved} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className={cls} data-lang={resolved ?? "text"}>
      <pre className="ofw-code__raw">
        <code>{code || ""}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;
