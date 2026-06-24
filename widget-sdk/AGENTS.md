# AGENTS.md — `@fusedio/widget-sdk`

Orientation for AI agents working in this package.

## What this package is

This SDK is the **public contract** between Fused json-ui hosts (the
workbench, the catalog-template sandbox, future embedders) and the React
components that render on top of them. It contains:

1. A dependency-injection interface (`FusedWidgetBridge`) implemented by
   the host.
2. React hooks that read the bridge from context and let component authors
   talk to canvas state without knowing anything about the host's internals
   (Jotai, DuckDB-WASM, the workbench fetcher, etc).
3. A small set of pure utilities (SQL placeholder parsing, form param store).

**The SDK is host-agnostic.** It does not import anything from `client/`,
the workbench, or any Fused infrastructure. Its only runtime dependency is
React ≥18 (peer dep). The host implements the bridge; the SDK consumes it.

## Mental model

```
┌───────────────────────────────────────────────────────────────────────┐
│   Component author writes:                                             │
│                                                                        │
│     useFusedParam({ param: "city", defaultValue: "" })                 │
│                                                                        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ reads
                                   ▼
                ┌──────────────────────────────────────┐
                │ FusedWidgetBridgeContext (React ctx) │
                └──────────────────┬───────────────────┘
                                   │ provided by host
   ┌───────────────────────────────┼──────────────────────────────┐
   ▼                               ▼                              ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ workbench-bridge.ts  │  │ catalog-template     │  │ future hosts         │
│ (client/)            │  │  test/bridge.ts      │  │  (mobile, embed)     │
│                      │  │                      │  │                      │
│ - Jotai atoms        │  │ - in-memory Maps     │  │ - whatever fits      │
│ - DuckDB-WASM        │  │ - mock signer        │  │                      │
│ - signed-url fetcher │  │ - no UDF execution   │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

The bridge interface is the **only** API surface that hosts must implement.
Adding a capability to the SDK starts with a method on `FusedWidgetBridge`.

## Layout

```
src/
  index.ts             — public surface; re-exports everything else
  bridge.ts            — FusedWidgetBridge interface + React context + node-override context
  protocol.ts          — BroadcastChannel name + message shape (host wire protocol)
  form.ts              — FormContext + FormParamsStore + useFormParams hook (pure React)
  types.ts             — public types for hook options/returns
  hooks/
    use-fused-param.ts            — two-way bind a component to a canvas param
    use-canvas-params.ts          — read many canvas params at once (edge-filtered)
    use-allowed-sources.ts        — which UDFs can broadcast to this node?
    use-allowed-udf-names.ts      — set of UDF names this node may reference
    use-param-substitution.ts     — resolve `$param` / `{{udf}}` in templates
    use-udf-output.ts             — read a UDF's output snapshot + helpers
    use-duckdb-sql.ts             — run DuckDB-WASM queries against UDF parquet
    use-url-signing.ts            — sign S3/GCS/FD URLs (and `useMediaSrc`)
    use-upload-access-check.ts    — pre-flight upload destination check
    use-json-ui-log.ts            — write/read runtime log entries
    use-json-ui-edge-animation.ts — animate canvas edges around async work
    use-json-ui-udf-info.ts       — current node identity (udfName, configHash)
  utils/
    sql-placeholders.ts  — pure parsing for `{{udf}}`/`$param`/signable URL literals in SQL
```

Roughly 1.5k LOC of source. Bundle output: ~10kB minified ESM.

## Two layers, one rule

The SDK has two cleanly separated layers:

| Layer            | Imports                              | Purpose                                          |
| ---------------- | ------------------------------------ | ------------------------------------------------ |
| **Hooks**        | React, bridge, form, protocol, utils | What component authors call                      |
| **Bridge + utils** | React (form/bridge), pure TS (utils) | Contract host implements; pure helpers          |

**Rule:** the SDK never imports anything outside `react` and itself. If you
find yourself wanting to import from `client/`, `server/`, `fused-py/`, or
any workspace package — stop. Add a method to the bridge instead.

## Hook conventions

All hooks follow the same pattern:

1. Read the bridge via `useFusedWidgetBridge()` — throws if no provider.
2. Adapt the bridge's subscribe/getSnapshot pair to React's
   `useSyncExternalStore`.
3. Use stable `useRef` snapshots + structural equality to avoid spurious
   re-renders when the host re-broadcasts identical values.
4. Memo the param-names array passed to the bridge so subscription churn
   doesn't cascade (`useStableStringArray` pattern).

When adding a new hook, mirror this pattern. `useUdfOutputByName` is the
shortest reference; `useFusedParam` is the most feature-complete (debounce,
broadcast-on-mount, form integration, clear-on-unmount, log preview).

## Param flow (most important to understand)

```
Component A                                  Component B
useFusedParam("city", setValue=NYC)        useFusedParam("city")
   │                                            ▲
   │ bridge.params.set("city", "NYC")           │ bridge.params.subscribe("city", …)
   ▼                                            │
host (workbench-bridge.ts)                      │
   │ broadcastParam() → BroadcastChannel        │
   │                                            │
   ▼                                            │
canvas-param-listener.ts → edge-filtered → canvasParamStateAtom
                                              │
                                              └──── component B re-renders
```

Notable details:

- The channel name `"parameter-updates"` is part of the **wire protocol** —
  don't change it without coordinating with every host implementation and
  every in-the-wild catalog bundle.
- `bridge.params.getSnapshot` returns the **edge-filtered** value — only
  upstream-connected nodes' broadcasts are visible. The SDK never sees raw
  unfiltered state.
- `setValue` debounces by default (300ms). `broadcastNow` skips debounce.
  `clearValue` sends a `CLEAR` message which the host treats as null.
- `useFusedParam` clears its bound param on unmount. This is intentional —
  it prevents stale values from one widget type lingering when the user
  swaps to a different preset — but it can surprise authors who treat
  `useFusedParam` as plain local state.

## SQL pipeline (the heaviest hook)

`useDuckDbSqlQuery` is the hairiest hook. The flow is:

1. Parse `{{udf}}` and `$param` placeholders out of the SQL.
2. Subscribe to every canvas/form param the SQL references.
3. For each `{{udf?k=v}}` placeholder where `v` is `$param`, resolve the
   param value; if still unresolved, keep loading.
4. Ask `bridge.sql.resolveVfsFilenames` to register every (udf, overrides)
   pair in DuckDB's virtual filesystem.
5. Substitute placeholders → filenames; substitute `$params` → escaped SQL
   literals.
6. Scan the resulting SQL for `'s3://…' / 'gs://…' / 'fd://…'` string
   literals and ask `bridge.signUrl` to sign each.
7. Append `LIMIT n` if missing.
8. Call `bridge.sql.query` and surface `{ rows, columns, loading, error }`.

All host-specific work (VFS registration, signing, query execution) is
delegated to the bridge. The SDK owns parsing, orchestration, cancellation,
and React state.

## Adding a new capability

A typical change looks like:

1. **Add a method to the bridge.** Update `FusedWidgetBridge` in
   `bridge.ts` with a new method or sub-bridge. Document what hosts must
   implement.
2. **Write the hook.** Follow the
   `useFusedWidgetBridge` + `useSyncExternalStore` pattern. Keep host
   specifics out — only consume the new bridge method.
3. **Implement on the workbench side.** Update
   `client/src/udfrun/json-ui/workbench-bridge.ts`.
4. **Implement on the catalog-template side.** Update
   `test/bridge.ts` in the catalog-template repo
   (https://github.com/fusedio/catalog-template) so the local sandbox keeps working.
5. **Export from `index.ts`.**

If you only need a new pure utility (no host interaction), put it in
`utils/` and re-export it from `index.ts`.

## Things that look weird but are intentional

- **Many `eslint-disable react-hooks/exhaustive-deps`** in
  `use-fused-param.ts`. Each one is annotated with the reason — usually
  about not re-running the broadcast/clear effects on transient
  bridge-identity flips. Don't "fix" these without reading the comment.
- **`useFusedParam` cleanup uses `[]` deps and reads from refs.** Same
  reason — bridge identity flips would otherwise cause every bound param
  to clear and cascade across the canvas.
- **`useJsonUiLog`'s `log` callback is built from refs with stable identity.**
  Downstream effects have `log` in their deps; instability there would
  cause SQL widgets across the dashboard to re-fire.
- **`JsonUiNodeOverrideContext`** sits between the bridge and a few hooks.
  It exists so nested `JsonUiConfigHashOverride` subtrees can tag logs
  with a different `configHash` without rebuilding the entire bridge.
- **`resolveVfsFilenames` returns a `Map | VfsResolveResult` union**. The
  `Map` shape is the legacy bridge surface; new callers pass `VfsResolveRef[]`
  and get the richer `VfsResolveResult`. Keep the union until all hosts
  upgrade.
- **`useFusedParam` clears its param on unmount.** Documented above —
  intentional, prevents preset-swap leaks.

## Things to NOT do

- Don't `import` from anywhere outside this package (other than `react`).
- Don't add a runtime dependency unless absolutely necessary — every dep is
  a peer-conflict risk for catalog authors.
- Don't change the BroadcastChannel name (`"parameter-updates"`) or the
  `StandardMessage` shape without a wire-protocol migration plan.
- Don't move host-specific state into the SDK. If a hook needs a fetcher,
  a token, a Jotai store, an env URL — add it to the bridge instead.
- Don't introduce circular deps between hooks. The current order is roughly
  `utils → form → bridge → individual hooks → index`.

## Test surfaces

There are no unit tests in this package today. The de-facto integration
test is the `catalog-template` local sandbox, which lives in its own repo:
https://github.com/fusedio/catalog-template

```
git clone https://github.com/fusedio/catalog-template && cd catalog-template && bun run dev
```

Any change to the SDK should be smoke-tested by rendering at least one
example component in the sandbox (e.g. `CounterButton.tsx`) and verifying
that params broadcast through the in-memory bridge.

## Versioning + publishing

- The package is currently `0.0.1` and **not yet published to npm.**
- Once published, **the public hook surface is a wire contract** — catalog
  bundles in the wild will be built with `@fusedio/widget-sdk` marked as
  `external` (see `build.mjs` in https://github.com/fusedio/catalog-template),
  and the host resolves the
  bare specifier to its already-loaded SDK instance via a runtime import
  map (see `installCatalogImportMap` in `client/src/udfrun/json-ui/
  custom-catalog-loader.ts`). Breaking exports or signatures will break
  shipped catalogs whose import maps still point at the workbench's SDK.
- Treat the bridge interface and every exported hook signature as semver
  sensitive after first publish.

## Related docs

- Architecture (host-side rendering pipeline, registry, etc.):
  `.claude/agent-memory/json-ui-agent/` in the parent repo.
- Consumer guide: `CLAUDE.md` in https://github.com/fusedio/catalog-template.
- Public README: `./README.md`.
