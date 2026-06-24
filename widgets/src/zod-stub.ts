// zod-stub.ts — a build-time stand-in for the `zod` module, wired in ONLY for
// the RENDER bundle via an esbuild onResolve plugin in build.mjs (scoped to the
// exact `zod` specifier). The agent-facing catalog generator (generate.ts) uses
// the REAL zod; this stub never runs there.
//
// Why: every json-ui component module imports `z` to declare its prop schema
// (`z.object({...}).extend(UNIVERSAL_PROPS.shape).describe(...)`). Those schemas
// exist for the agent catalog / server-side validation and are evaluated at
// MODULE LOAD, but NO render path ever `.parse()`s with them. Bundling real zod
// (~300KB) would be dead weight inlined into the widget.html resource.
//
// Aliasing `zod` to this no-op keeps the schema-declaration syntax valid (every
// call/property access returns a chainable, callable proxy) while bundling
// nothing.
//
// HARDENING over application's reference: component modules do
//   z.object({ ... }).extend(UNIVERSAL_PROPS.shape)
// at module-load time. `UNIVERSAL_PROPS.shape` must therefore be SPREAD-SAFE:
// `{ ...X.shape }` must yield an EMPTY object (no own ENUMERABLE keys), and
// `for (const k of X.shape)` must not throw.
//
// A Proxy must obey JS invariants: because the target is a FUNCTION (so the
// `apply`/`construct` traps fire for `z.string()`, `new z.ZodObject()`, etc.),
// the function has a NON-CONFIGURABLE own `prototype` property. The proxy
// therefore MUST report `"prototype"` from `ownKeys` and MUST return the real
// descriptor from `getOwnPropertyDescriptor("prototype")` — otherwise V8 throws
// `'ownKeys' on proxy: trap result did not include 'prototype'`. That is the
// ONE concession the application's reference (which never spread `.shape`)
// didn't need. It is safe for spread-safety: a function's `prototype` is
// NON-ENUMERABLE, and `{...x}` / `Object.keys` copy only ENUMERABLE own props,
// so the spread is still empty. Every OTHER key reports `undefined` (absent).
//
// So the proxy below:
//   • get-trap   → returns the proxy for ANY string/number key (chaining), a
//                  no-op iterator for Symbol.iterator (for-of safe), and
//                  undefined for `then` (not a thenable);
//   • apply-trap → returns the proxy (so `z.string()`, `.default(0)`, `.union([])`
//                  etc. all chain);
//   • ownKeys    → ["prototype"] ONLY (the invariant-required key; non-enumerable);
//   • getOwnPropertyDescriptor → the real descriptor for `prototype`, else undefined;
//   • has        → false for everything except `prototype` (invariant: a
//                  non-configurable own key must report present);
// The single recursive proxy is its own `.shape`, its own `.optional()`, etc. —
// uniformly spread-safe everywhere it appears.

// The callable target. Captured so the traps can read its real `prototype`
// descriptor (required by the Proxy ownKeys/getOwnPropertyDescriptor invariants).
const target = function () {} as (...args: unknown[]) => unknown;

const handler: ProxyHandler<(...args: unknown[]) => unknown> = {
  get(_target, prop) {
    // for-of / spread of an iterable: hand back an empty iterator so
    // `[...z.something]` and `for (const x of z.something)` never throw.
    if (prop === Symbol.iterator) {
      return function* () {
        /* empty */
      };
    }
    // Avoid masquerading as a thenable/Promise (so `await schema` and
    // Promise.resolve(schema) don't try to call a fake `.then`).
    if (prop === "then") return undefined;
    // ANY other key (incl. `.shape`, `.optional`, `.default`, `.describe`,
    // toPrimitive, Symbol.toStringTag) returns the proxy so chaining +
    // stringification stay inert rather than throwing.
    return proxy;
  },
  apply() {
    // z.object({...}), .extend(x), .default(v), .optional(), .describe(s),
    // .union([...]), .enum([...]), .string()/.number()/.boolean()/.array()/.null()
    // — every call returns the same chainable proxy.
    return proxy;
  },
  // Constructed forms (`new z.ZodObject()` etc.) also return the proxy.
  construct() {
    return proxy as unknown as object;
  },
  // SPREAD SAFETY: report ONLY the invariant-required `prototype` (a function's
  // non-configurable own key). It is NON-ENUMERABLE, so `{ ...X.shape }`,
  // `Object.keys(X.shape)`, and esbuild's copy-props helper still see NOTHING.
  ownKeys() {
    return ["prototype"];
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (prop === "prototype") {
      return Object.getOwnPropertyDescriptor(target, "prototype");
    }
    return undefined;
  },
  has(_target, prop) {
    // A non-configurable own key must report present; everything else absent.
    return prop === "prototype";
  },
  // Setting properties is a silent no-op (some schema builders assign metadata).
  set() {
    return true;
  },
};

// A callable target so the `apply`/`construct` traps engage; the proxy is its
// own everything (recursively self-returning).
const proxy: any = new Proxy(target, handler);

// `import { z } from "zod"` and `import z from "zod"` both resolve to the proxy.
export const z: any = proxy;
export default proxy;
