import { describe, it, expect, vi } from "vitest";

// The diff widget is a thin pass-through to <DiffView>. We mock the SDK and assert
// the props are threaded straight through (the diff LOGIC is covered by
// diff-view.test.ts).
vi.mock("@fusedio/widget-sdk", () => ({
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

const { default: definition } = await import("../diff");

type El = { type: unknown; props: Record<string, unknown> };

function render(props: Record<string, unknown>): El {
  const component = definition.component as unknown as (p: { element: unknown }) => El;
  return component({ element: { type: "diff", props, children: [] } });
}

describe("diff widget", () => {
  it("threads before/after/labels to DiffView", () => {
    const el = render({ before: "a", after: "b", oldLabel: "v1", newLabel: "v2" });
    expect(el.props.before).toBe("a");
    expect(el.props.after).toBe("b");
    expect(el.props.oldLabel).toBe("v1");
    expect(el.props.newLabel).toBe("v2");
    expect(el.props.diff).toBeUndefined();
  });

  it("threads a precomputed unified diff", () => {
    const el = render({ diff: "@@ -1 +1 @@\n-a\n+b" });
    expect(el.props.diff).toBe("@@ -1 +1 @@\n-a\n+b");
  });

  it("is not an input", () => {
    expect(definition.writesParam).toBe(false);
  });
});
