// Pure language-resolution logic for the shared CodeBlock. Lives under
// src/widgets/** so the fast node tier (vitest.config.ts) picks it up; it does
// NOT touch the DOM or shiki (those are exercised in codeblock.browser.test.tsx
// under a real Chromium). normalizeLang maps a file extension OR an explicit
// language token to a shiki grammar id, and returns null for anything we don't
// highlight (so the component falls back to plain monospace).
import { describe, it, expect } from "vitest";
import { normalizeLang, CODE_LANGS } from "../../components/CodeBlock";

describe("normalizeLang", () => {
  it("maps Python by extension and by name", () => {
    expect(normalizeLang("py")).toBe("python");
    expect(normalizeLang("python")).toBe("python");
  });

  it("derives the language from a filename", () => {
    expect(normalizeLang("main.py")).toBe("python");
    expect(normalizeLang("query.sql")).toBe("sql");
  });

  it("maps the common code extensions used across the app", () => {
    expect(normalizeLang("ts")).toBe("typescript");
    expect(normalizeLang("tsx")).toBe("tsx");
    expect(normalizeLang("js")).toBe("javascript");
    expect(normalizeLang("json")).toBe("json");
    expect(normalizeLang("sh")).toBe("bash");
    expect(normalizeLang("yml")).toBe("yaml");
    expect(normalizeLang("yaml")).toBe("yaml");
    expect(normalizeLang("toml")).toBe("toml");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeLang("  PY ")).toBe("python");
  });

  it("returns null for unknown or empty input (plain-text fallback)", () => {
    expect(normalizeLang("log")).toBeNull();
    expect(normalizeLang("")).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
    expect(normalizeLang(null)).toBeNull();
  });

  it("every resolved language is one we preload into the highlighter", () => {
    for (const token of ["py", "ts", "tsx", "js", "json", "sql", "sh", "yml", "toml", "md"]) {
      const lang = normalizeLang(token);
      expect(lang).not.toBeNull();
      expect(CODE_LANGS).toContain(lang);
    }
  });
});
