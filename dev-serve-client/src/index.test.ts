import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * Unit coverage for the `@fusedio/dev-serve-client` → `dev serve` proxy
 * (spec/dev-serve.md, spec/ui/widget-host-migration.md §1.1).
 *
 * The cutover replaced N per-project `widget data-serve` daemons with ONE shared
 * `openfused dev serve` process, addressed per request by `?workspace=&project=`
 * (or `?dir=`/`?projectDir=`) query params (the body stays pure payload). These
 * tests mock `node:child_process` `spawn` (a fake child that emits the JSON
 * handshake on stdout) and the global `fetch` to assert, without a real server:
 *  - a single shared process is spawned and REUSED across calls;
 *  - the outbound URL carries `?t=&workspace=&project=` and the right path;
 *  - the request body is forwarded verbatim;
 *  - the directory-mode proxy addresses by `?dir=`/`?projectDir=`;
 *  - a non-JSON error body becomes a readable error, not a parse crash.
 *
 * The 503 env pre-check is NOT here — it lives app-side in `widget-data.ts`
 * (it depends on `projects.ts`); see `app/src/server/widget-data.test.ts`.
 */

const HANDSHAKE = {
  origin: "http://127.0.0.1:5555",
  token: "tok-abc",
  port: 5555,
  pid: 4242,
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid = HANDSHAKE.pid;
  kill = vi.fn((_signal?: string) => {
    this.exitCode = 0;
    return true;
  });
}

let spawnCalls: Array<{ command: string; args: string[] }>;
let fetchMock: ReturnType<typeof vi.fn>;

/** Reset module state + mocks, then import a fresh dev-serve-client module. */
async function loadModule() {
  vi.resetModules();
  spawnCalls = [];

  vi.doMock("node:child_process", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    return {
      ...actual,
      spawn: (command: string, args: string[]) => {
        spawnCalls.push({ command, args });
        const child = new FakeChild();
        // Emit the handshake line asynchronously so readline's "line" fires.
        queueMicrotask(() => child.stdout.write(`${JSON.stringify(HANDSHAKE)}\n`));
        return child as unknown as import("node:child_process").ChildProcess;
      },
    };
  });

  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: {}, errors: {}, depMap: {}, config: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  return import("./index.js");
}

beforeEach(async () => {
  // OPENFUSED_BIN unset → command "openfused", args [] → ["dev", "serve"].
  delete process.env.OPENFUSED_BIN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("node:child_process");
});

describe("dev-serve-client → dev serve proxy", () => {
  it("spawns ONE shared `dev serve` and reuses it across calls", async () => {
    const { postToDevServe } = await loadModule();

    await postToDevServe("default", "proj-a", "/api/exec/widget", { config: { type: "text" } });
    await postToDevServe("default", "proj-b", "/api/exec/widget", { config: { type: "text" } });

    expect(spawnCalls).toHaveLength(1); // one process for both calls
    expect(spawnCalls[0].args).toEqual(["dev", "serve"]);
  });

  it("addresses via query params and forwards the body verbatim (postToDevServe)", async () => {
    const { postToDevServe } = await loadModule();
    const body = { config: { type: "sql-table" }, params: { region: "NY" }, only: ["q0"] };

    const res = await postToDevServe("default", "proj-a", "/api/exec/widget", body);

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/exec/widget");
    expect(parsed.searchParams.get("t")).toBe("tok-abc");
    expect(parsed.searchParams.get("workspace")).toBe("default");
    expect(parsed.searchParams.get("project")).toBe("proj-a");
    expect(JSON.parse(init.body as string)).toEqual(body); // verbatim, no addressing merged in
  });

  it("addresses the directory mode by ?dir= / ?projectDir= (resolveWidgetDataDir / executeUdfDir)", async () => {
    const { resolveWidgetDataDir, executeUdfDir } = await loadModule();

    await resolveWidgetDataDir("/abs/dir", null, { config: {} });
    let [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    let parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/exec/widget");
    expect(parsed.searchParams.get("dir")).toBe("/abs/dir");
    expect(parsed.searchParams.has("projectDir")).toBe(false);

    await executeUdfDir("/abs/dir", "/abs/skill", { udf: "hello", overrides: {} });
    [url] = fetchMock.mock.calls[1] as [string, RequestInit];
    parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/exec/udf");
    expect(parsed.searchParams.get("projectDir")).toBe("/abs/skill");
    expect(parsed.searchParams.has("dir")).toBe(false);
  });

  it("surfaces a non-JSON error body as a readable error, not a parse crash", async () => {
    const { postToDevServe } = await loadModule();
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }),
    );

    const res = await postToDevServe("default", "proj-a", "/api/exec/widget", { config: {} });

    expect(res.status).toBe(500);
    expect((res.payload as { error: string }).error).toContain("non-JSON 500");
  });
});
