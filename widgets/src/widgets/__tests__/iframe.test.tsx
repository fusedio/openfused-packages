// iframe.test.tsx — regression tests for the iframe authoring-mistake guard.
//
// THE BUG: agents often emit {"type":"iframe","props":{"udf":"my_udf"}} —
// trying to display a local UDF's output via an iframe. The `udf` prop does not
// exist; the component reads `src` as undefined, fails the URL-safety check, and
// used to render a generic "iframe src must be an absolute http(s) URL" error.
// That message gives no hint about the wrong prop name or the right fix, making
// it impossible to self-diagnose from the rendered output.
//
// THE FIX (iframe.tsx): detect `udf`/`url`/`href` props and surface a specific
// actionable error naming the wrong prop and pointing to native sql components.

import { describe, it, expect, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@fusedio/widget-sdk", () => ({
  parseStyle: (_s: unknown) => ({}),
  defineComponent: (def: unknown) => def,
}));

// Import AFTER mocks so the component closes over them.
const { default: definition } = await import("../iframe");

type ComponentDef = { component: React.ComponentType<{ element: unknown }> };

function renderIframe(props: Record<string, unknown>): string {
  const { component: Component } = definition as unknown as ComponentDef;
  return renderToStaticMarkup(
    createElement(Component, {
      element: { type: "iframe", props, children: [] },
    }),
  );
}

describe("iframe — authoring mistake guard", () => {
  it("renders a blocked placeholder with an actionable hint when `udf` prop is used", () => {
    const html = renderIframe({ udf: "my_html_udf" });
    expect(html).toContain("ofw-iframe-blocked");
    // Must mention the wrong prop name so the author knows what to fix.
    expect(html).toContain("udf");
    // Must point to the correct alternative (sql components).
    expect(html).toContain("sql");
  });

  it("shows the same actionable hint for `url` prop", () => {
    const html = renderIframe({ url: "https://example.com" });
    expect(html).toContain("ofw-iframe-blocked");
    expect(html).toContain("url");
    expect(html).toContain("sql");
  });

  it("shows the same actionable hint for `href` prop", () => {
    const html = renderIframe({ href: "https://example.com" });
    expect(html).toContain("ofw-iframe-blocked");
    expect(html).toContain("href");
    expect(html).toContain("sql");
  });

  it("shows the GENERIC src error (no sql hint) when src is present but not http(s)", () => {
    // Author knows about `src` but used a non-http scheme — different mistake,
    // different message (no "use sql" hint, which would be misleading here).
    const html = renderIframe({ src: "javascript:alert(1)" });
    expect(html).toContain("ofw-iframe-blocked");
    expect(html).toContain("absolute http");
    expect(html).not.toContain("sql");
  });

  it("shows the generic src error for a {{udf}} placeholder in src", () => {
    // Agents sometimes try {{my_udf}} as the src value — correct prop but
    // the placeholder is not resolved locally, so the URL parse fails.
    const html = renderIframe({ src: "{{my_udf}}" });
    expect(html).toContain("ofw-iframe-blocked");
    expect(html).toContain("absolute http");
  });

  it("renders a real <iframe> for a valid https src", () => {
    const html = renderIframe({ src: "https://example.com/dashboard" });
    expect(html).not.toContain("ofw-iframe-blocked");
    expect(html).toContain("<iframe");
    expect(html).toContain("https://example.com/dashboard");
  });

  it("renders a real <iframe> for a valid http src", () => {
    const html = renderIframe({ src: "http://localhost:3000/embed" });
    expect(html).not.toContain("ofw-iframe-blocked");
    expect(html).toContain("<iframe");
  });
});
