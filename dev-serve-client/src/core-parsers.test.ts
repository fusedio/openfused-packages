import { describe, it, expect } from "vitest";
import { coreProjectFromUdf, coreProjectFromConfig } from "./index.js";

/**
 * A `_core` widget exec runs in the ADDRESSED project's materialized venv (dev
 * serve resolves the ref source via shared_roots but executes on the addressed
 * project's interpreter). So `executeCoreUdf` must address each exec at the
 * project named in its fully-qualified `_core.<project>.<udf>` name — otherwise
 * e.g. a `_core.secrets-management.put` routed through `task-management` fails
 * with "keyring not installed" (task-management's venv lacks keyring). These pure
 * helpers derive that project; the route tests mock the whole function. They live
 * in `@fusedio/dev-serve-client` (both hosts import them;
 * spec/ui/widget-host-migration.md §6 #6).
 */
describe("coreProjectFromUdf", () => {
  it("extracts the project from a fully-qualified _core.<project>.<udf> name", () => {
    expect(coreProjectFromUdf("_core.secrets-management.put")).toBe("secrets-management");
    expect(coreProjectFromUdf("_core.secrets-management.list")).toBe("secrets-management");
    expect(coreProjectFromUdf("_core.agents-management.read")).toBe("agents-management");
    expect(coreProjectFromUdf("_core.task-management.update_status")).toBe("task-management");
  });

  it("returns null for a bare/unqualified or non-string name (caller falls back)", () => {
    expect(coreProjectFromUdf("read")).toBeNull();
    expect(coreProjectFromUdf("_core")).toBeNull();
    expect(coreProjectFromUdf("_core.")).toBeNull();
    expect(coreProjectFromUdf(undefined)).toBeNull();
    expect(coreProjectFromUdf(null)).toBeNull();
    expect(coreProjectFromUdf(42)).toBeNull();
  });
});

/**
 * The READ/widget-data sibling of `coreProjectFromUdf`. A widget-data resolve
 * ships ONE resolver code string to ONE venv, so a config reading
 * `{{_core.agents-management.read}}` (imports pyyaml) MUST be addressed at
 * `agents-management` — routed through the canonical `task-management` it fails
 * with "No module named 'yaml'". This helper derives that project from the
 * config's `{{_core.<project>.<udf>}}` SQL refs.
 */
describe("coreProjectFromConfig", () => {
  it("extracts the project from a config's {{_core.<project>.<udf>}} SQL ref", () => {
    const body = {
      config: {
        type: "agent-detail",
        props: { agentSlug: "architect", sql: "SELECT * FROM {{_core.agents-management.read?slug=$agentSlug}}" },
      },
      params: { agentSlug: "architect" },
    };
    expect(coreProjectFromConfig(body)).toBe("agents-management");
  });

  it("handles refs with no query string and surrounding whitespace", () => {
    expect(
      coreProjectFromConfig({ config: { props: { sql: "SELECT * FROM {{ _core.task-management.list }}" } } }),
    ).toBe("task-management");
  });

  it("finds the ref in a nested child config (canvas)", () => {
    const body = {
      config: {
        type: "canvas",
        children: [{ type: "table", props: { sql: "SELECT * FROM {{_core.secrets-management.list}}" } }],
      },
    };
    expect(coreProjectFromConfig(body)).toBe("secrets-management");
  });

  it("returns null when no _core refs are present (caller falls back to canonical)", () => {
    expect(coreProjectFromConfig({ config: { props: { sql: "SELECT 1" } } })).toBeNull();
    expect(coreProjectFromConfig({ config: null })).toBeNull();
    expect(coreProjectFromConfig({})).toBeNull();
    expect(coreProjectFromConfig(null)).toBeNull();
  });

  it("returns null when the config references MORE THAN ONE distinct _core project", () => {
    // No single venv satisfies a multi-project config; caller falls back to canonical.
    const body = {
      config: {
        children: [
          { props: { sql: "SELECT * FROM {{_core.agents-management.read}}" } },
          { props: { sql: "SELECT * FROM {{_core.secrets-management.list}}" } },
        ],
      },
    };
    expect(coreProjectFromConfig(body)).toBeNull();
  });

  it("returns the same project when multiple refs share it", () => {
    const body = {
      config: {
        children: [
          { props: { sql: "SELECT * FROM {{_core.task-management.list}}" } },
          { props: { sql: "SELECT * FROM {{_core.task-management.read?id=$id}}" } },
        ],
      },
    };
    expect(coreProjectFromConfig(body)).toBe("task-management");
  });
});
