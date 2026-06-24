// secrets-manager.test.ts — guards the in-UDF access snippet the Secrets page's
// copy button hands the user (next to reveal/delete). The snippet MUST be the
// sanctioned read path `openfused.get_secret(<name>)` (spec/secrets.md,
// spec/sdk-openfused.md), with the name as a safe, escaped string literal — the
// clipboard wiring itself is thin and verified in the live app.

import { describe, it, expect } from "vitest";
import { accessSnippet } from "../secrets-manager";

describe("accessSnippet", () => {
  it("builds the sanctioned openfused.get_secret(...) call with the name as a string literal", () => {
    expect(accessSnippet("my-api-key")).toBe('openfused.get_secret("my-api-key")');
    expect(accessSnippet("openfused-pg-conn")).toBe('openfused.get_secret("openfused-pg-conn")');
  });

  it("escapes quotes and backslashes so an exotic name stays a valid, safe argument", () => {
    expect(accessSnippet('a"b')).toBe('openfused.get_secret("a\\"b")');
    expect(accessSnippet("a\\b")).toBe('openfused.get_secret("a\\\\b")');
  });
});
