# @fusedio/widget-sdk

React hooks and types for building custom **json-ui components** that run
inside the [Fused](https://fused.io) workbench canvas.

If you want to build a 3rd-party component catalog that the Fused workbench
can load — a custom chart, a custom input, a domain-specific widget — this
SDK is the contract your components depend on.

> **Status:** pre-1.0. The public hook surface is stabilising but minor
> breaking changes may still happen between `0.x` releases. The bridge
> interface (for host implementers) is more volatile and may grow.

## Installation

```bash
npm install @fusedio/widget-sdk
# or
bun add @fusedio/widget-sdk
```

React ≥18 is a peer dependency.

## The shape of a component

Every component receives a single `element` prop. Read your props out of
`element.props`, return JSX.

```tsx
import { useFusedParam, type ComponentRenderProps } from "@fusedio/widget-sdk";

interface CounterProps {
  param: string;
  label?: string;
  step?: number;
}

export function Counter({ element }: ComponentRenderProps<CounterProps>) {
  const { param, label = "Count", step = 1 } = element.props;
  const { value, setValue } = useFusedParam({ param, defaultValue: 0 });

  return (
    <button onClick={() => setValue(value + step)}>
      {label}: {value}
    </button>
  );
}
```

When the user clicks, `setValue` broadcasts the new value to the canvas;
any connected UDF re-runs with the updated parameter.

## What the hooks let you do

| Hook                           | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `useFusedParam`                | Two-way bind a component to a canvas parameter (debounced).         |
| `useCanvasParams`              | Read multiple canvas parameter values at once (edge-filtered).      |
| `useParamSubstitution`         | Resolve `$param` and `{{udf}}` placeholders inside a template.      |
| `useUdfOutputByName`           | Subscribe to a UDF's output, status, error.                         |
| `useUdfExecutor`               | Run a UDF on an event (`udf?param=1`); resolves `$param` at fire time. |
| `useUdfColumnValue` / `Values` | Pull values out of `{{udf.col}}` / `{{udf.col[idx]}}` queries.      |
| `useUdfDataFrameSample`        | Sample rows from a UDF's DataFrame output.                          |
| `useDuckDbSqlQuery`            | Run a DuckDB-WASM query against UDF parquet outputs in the browser. |
| `useUrlSigning` / `useMediaSrc` | Sign `s3://`, `gs://`, `fd://` URLs and resolve media sources.      |
| `useUploadAccessCheck`         | Pre-flight an upload destination for write access.                  |
| `useAllowedSources`            | Which UDFs are allowed to broadcast to this node?                   |
| `useAllowedUdfNames`           | Set of UDF names this node may reference.                           |
| `useJsonUiEdgeAnimation`       | Animate the canvas edge pellet around custom async work.            |
| `useJsonUiLog`                 | Write entries to the runtime logs panel.                            |
| `useJsonUiUdfInfo`             | Current node identity (`udfName`, `udfUniqueId`, `configHash`).     |

Every hook ships with `@example` blocks in its TypeScript declarations —
hover any import in your editor for the full signature, defaults, and
usage notes.

## Param flow at a glance

```
   Component A                                 Component B
   useFusedParam("city")                       useFusedParam("city")
        │                                            ▲
        ▼                                            │
  setValue("NYC")                                    │
        │                                            │
        ▼                                            │
  Fused workbench                                    │
   ─ broadcasts on BroadcastChannel ─►  edge-filtered routing
                                              │
                                              ▼
                                       value = "NYC"
```

- Values broadcast over a same-origin
  `BroadcastChannel("parameter-updates")`.
- The workbench filters by canvas edges: a component only **receives**
  values from upstream-connected nodes.
- `setValue` debounces (300ms default). Use `broadcastNow` to flush
  immediately (e.g. `onMouseUp` of a slider). Use `clearValue` to reset
  and notify the canvas.

## Running against the workbench

In the deployed Fused workbench your component is loaded as part of a
**catalog bundle**: a single ESM file built with `esbuild` that the user
adds to the workbench via *Settings → Custom Catalogs*. A minimal build
looks like:

```bash
esbuild src/index.ts --bundle --format=esm --outfile=dist/catalog.esm.js \
  --external:react --external:react/jsx-runtime \
  --external:@fusedio/widget-sdk --external:zod
```

These four specifiers are marked `external` because the workbench injects
a runtime import map that resolves them to its own already-loaded React,
SDK, and Zod instances — guaranteeing one React instance, one SDK
instance, one Zod instance across host + every loaded catalog. Without
that, hook calls hit a different React instance ("invalid hook call"),
and Zod schemas fail `instanceof` checks inside the workbench's
`z.toJSONSchema(...)` pass.

A starter template (with a local sandbox, hot reload, and a GitHub Action
that publishes the built bundle) will be linked here once it's published.

## Architecture

This SDK is a thin shell:

- **`FusedWidgetBridge`** is the interface the host implements (canvas
  params, UDF outputs, SQL execution, URL signing, …).
- **Hooks** read the bridge from `FusedWidgetBridgeContext` and adapt it to
  React via `useSyncExternalStore`.
- **Pure utilities** (`utils/sql-placeholders.ts`) parse SQL templates with
  no host dependencies.

The SDK itself does **no I/O, no fetches, no auth, no storage**. Every
side effect goes through the bridge — which the host (the Fused workbench
or your test harness) provides. This is why the same component code runs
unchanged in the workbench, in a local sandbox, and in any future host.

## Implementing a custom host (advanced)

Hosting json-ui components outside the Fused workbench:

```tsx
import {
  FusedWidgetBridgeContext,
  type FusedWidgetBridge,
} from "@fusedio/widget-sdk";

const myBridge: FusedWidgetBridge = {
  params: { /* … */ },
  udfs: { /* … */ },
  // … everything else
};

<FusedWidgetBridgeContext.Provider value={myBridge}>
  {/* render json-ui components here */}
</FusedWidgetBridgeContext.Provider>
```

You'll need to implement every sub-bridge (`params`, `udfs`, `routing`,
`sql`, `template`, `uploads`, `edges`, `log`, plus `signUrl` and `node`).
The exhaustive interface is exported as `FusedWidgetBridge` — hover it in
your editor for the full type.

## License

Apache-2.0
