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
// The shared highlighter: a one-time async load, then a synchronous instance.
// `codeToHtml` is SYNCHRONOUS once shiki is loaded, so highlighting can run in
// render and always reflect the current `code` — no stale-HTML window.
let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [shiki, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki"),
        import("shiki/engine/javascript"),
      ]);
      const hl = (await shiki.createHighlighter({
        themes: [THEME],
        langs: [...CODE_LANGS],
        engine: createJavaScriptRegexEngine(),
      })) as unknown as Highlighter;
      highlighterInstance = hl;
      return hl;
    })();
  }
  return highlighterPromise;
}

/**
 * Highlight `code` as `lang` (an already-normalized shiki grammar id, or null)
 * and return the shiki HTML. Once the shared highlighter is loaded the result is
 * computed synchronously from the CURRENT `code`/`lang` on every render, so it
 * never lags behind a changing `code` (the prior bug: serving a stale prior
 * highlight via `dangerouslySetInnerHTML`). The only async step is the one-time
 * load; until it resolves — and for no-lang / on error — this returns null and
 * the caller shows its plain-text fallback. Shared by CodeBlock (read) and
 * CodeEditor (the highlight layer behind the textarea).
 */
export function useHighlightedHtml(code: string, lang: string | null): string | null {
  // The singleton is null on first paint; re-render once it finishes loading.
  const [loaded, setLoaded] = React.useState<boolean>(highlighterInstance !== null);
  React.useEffect(() => {
    if (!lang || highlighterInstance) return;
    let alive = true;
    loadHighlighter()
      .then(() => {
        if (alive) setLoaded(true);
      })
      .catch(() => {
        /* load failed → stay on the plain fallback */
      });
    return () => {
      alive = false;
    };
  }, [lang]);

  return React.useMemo(() => {
    if (!lang || !highlighterInstance) return null;
    try {
      return highlighterInstance.codeToHtml(code ?? "", { lang, theme: THEME });
    } catch {
      return null; // grammar miss → plain fallback (never stale, never blank)
    }
    // `loaded` participates so the first sync highlight runs once the singleton lands.
  }, [code, lang, loaded]);
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
