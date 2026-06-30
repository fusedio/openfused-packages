// render-style-coerce.test.ts — the renderer must tolerate an OBJECT `style`.
//
// The json-ui contract is `style: string` (_universal.ts) and every widget does
// `parseStyle(props.style)`. parseStyle calls `.split(";")` on its input, so an
// agent-authored config that emits a React-style OBJECT (`{display:"flex"}`)
// makes parseStyle throw `style.split is not a function` — which, unguarded,
// unmounts the whole widget tree (the "black screen" bug, ITEM-11878). The
// renderer normalizes an object `style` to the CSS string parseStyle expects, at
// the single render choke point, so a malformed widget renders instead of crashing.

import { describe, it, expect } from "vitest";
import { parseStyle } from "@fusedio/widget-sdk";

import { styleObjectToCss } from "../../render";

describe("styleObjectToCss", () => {
  it("serializes a camelCase object to a kebab-case CSS string", () => {
    expect(
      styleObjectToCss({ display: "flex", flexDirection: "column", gap: "16px" }),
    ).toBe("display: flex; flex-direction: column; gap: 16px");
  });

  it("round-trips back through parseStyle to the original object", () => {
    const obj = { display: "flex", flexDirection: "row", flexWrap: "wrap", padding: "16px" };
    expect(parseStyle(styleObjectToCss(obj))).toEqual(obj);
  });

  it("drops null/empty values and stringifies numbers", () => {
    expect(styleObjectToCss({ gap: 16, padding: "", margin: null as unknown as string })).toBe(
      "gap: 16",
    );
  });

  it("never throws — the whole point is that parseStyle can digest the result", () => {
    const css = styleObjectToCss({ display: "flex" });
    expect(() => parseStyle(css)).not.toThrow();
  });
});
