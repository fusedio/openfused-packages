import { describe, it, expect, vi, beforeEach } from "vitest";

// The markdown widget mirrors `text`: priority sql > value, and the shared text
// skeleton while the query runs with nothing resolved yet (an authored `value`
// stays on screen). We mock the SDK so the component is a pure function of its inputs,
// then read the resolved `text` off the returned <MarkdownView> element (it is not
// rendered — react-markdown never runs).
let hookReturn: { rows: Record<string, unknown>[]; columns: string[]; loading: boolean } = {
  rows: [],
  columns: [],
  loading: false,
};

vi.mock("@fusedio/widget-sdk", () => ({
  useDuckDbSqlQuery: () => hookReturn,
  parseStyle: () => ({}),
  defineComponent: (def: unknown) => def,
}));

const { default: definition } = await import("../markdown");

type El = { type: unknown; props: { text?: string } };

function render(props: Record<string, unknown>): El {
  const component = definition.component as unknown as (p: { element: unknown }) => El;
  return component({ element: { type: "markdown", props, children: [] } });
}

beforeEach(() => {
  hookReturn = { rows: [], columns: [], loading: false };
});

describe("markdown widget", () => {
  it("renders the literal `value` when no sql", () => {
    expect(render({ value: "# Hi" }).props.text).toBe("# Hi");
  });

  it("renders empty string when nothing is provided", () => {
    expect(render({}).props.text).toBe("");
  });

  it("prefers the sql first-cell over value", () => {
    hookReturn = { rows: [{ md: "## From SQL" }], columns: ["md"], loading: false };
    expect(render({ value: "ignored", sql: "select 1" }).props.text).toBe("## From SQL");
  });

  it("shows the skeleton while the sql query runs and nothing is resolved", () => {
    hookReturn = { rows: [], columns: [], loading: true };
    // No value + loading → the shared skeleton (a <div>), not a MarkdownView text.
    expect(render({ sql: "select 1" }).props.text).toBeUndefined();
  });

  it("keeps the authored value on screen while the sql query runs", () => {
    hookReturn = { rows: [], columns: [], loading: true };
    expect(render({ value: "x", sql: "select 1" }).props.text).toBe("x");
  });

  it("falls back to value when the sql cell is empty", () => {
    hookReturn = { rows: [{ md: null }], columns: ["md"], loading: false };
    expect(render({ value: "fallback", sql: "select 1" }).props.text).toBe("fallback");
  });

  it("is not an input", () => {
    expect(definition.writesParam).toBe(false);
  });
});
