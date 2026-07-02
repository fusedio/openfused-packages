// render.tsx — recursive renderer for the {element}-contract widget tree.
//
// STAGE-2 REWRITE. The previous renderer rendered each component by SPREADING
// the node's props (`<Component {...props}>`). The new openfused json-ui
// components are authored against `@fusedio/widget-sdk`'s `ComponentRenderProps`
// contract: each receives a SINGLE `element` prop — `{ type, props, children }`
// — and reads `element.props`. They reach host state ONLY through SDK hooks
// (`useFusedParam` for inputs, `useDuckDbSqlQuery` for data) that read a
// `FusedWidgetBridge` from `FusedWidgetBridgeContext`. So this walk:
//
//   1. wraps the whole tree in <FusedWidgetBridgeContext.Provider value={bridge}>
//      (the static bridge built by main.tsx from the received payload);
//   2. for each node, looks up registry[node.type] (the barrel `./widgets`),
//      renders <Component element={{ type, props, children }} /> — the SINGLE
//      element prop, NEVER spread — passing the recursively-rendered children as
//      `element.children`;
//   3. for a data-bound node (resolver stamped `props._queryId`), wraps the
//      component in <JsonUiBindingContext.Provider value={{ queryId }}> so the
//      SDK's `useDuckDbSqlQuery` threads that id into `bridge.sql.query`
//      (ported from application/client/src/mcp-host/registry.ts → withQueryIdBinding);
//   4. renders any UNKNOWN type as a visible placeholder, never a crash.
//
// NOTE: there is NO universal `visible` prop / conditional-render gate — the
// Fused application has no node-level `visible`, so openfused dropped it to keep
// configs a strict paste-compatible subset (see spec/ui/json-ui.md).

import React from "react";
import {
  FusedWidgetBridgeContext,
  JsonUiBindingContext,
  type FusedWidgetBridge,
} from "@fusedio/widget-sdk";

import { LoadingBusContext, createLoadingBus } from "./loading-bus";

import { registry, type ComponentRenderer } from "./widgets";
import allowedPropsMap from "./widgets/generated/allowed-props.json";

// Build-time-baked per-type allow-set: the keys of each component's sanitized
// Draft-07 propsSchema (emitted by scripts/generate.ts). The renderer soft-warns
// on any authored prop outside this set so an agent sees what the live bundle
// silently dropped. The browser is authoritative for what actually renders.
const ALLOWED_PROPS: Record<string, string[]> = allowedPropsMap;

// Props that are legitimately present on many nodes but are NOT declared in each
// widget's schema, so they must never trigger a warning:
//   • `_queryId` — planner-injected data-binding id (threaded via context), not
//     an authored prop and absent from every schema.
//   • `style`   — coerced generically by `coerceStyleProp` and read via
//     `parseStyle`; the universal layer still declares `css`, so `style` is not
//     in some widgets' generated prop lists.
//   • `comments` / `__comments` — framework-reserved page-level comment seeds:
//     `harvestInitialParams` (data-store.ts) reads `props.comments` (and accepts
//     `props.__comments`) off ANY node, incl. non-`canvas` roots, so they are
//     valid on nodes whose per-type schema doesn't declare them.
const ALWAYS_ALLOWED = new Set([
  "_queryId",
  "style",
  "comments",
  "__comments",
  // `refreshInterval` is a universal data-source prop (a live-dashboard poll on
  // any data-bound node; harvested by `collectRefreshIntervals`, not a
  // per-component authored prop) — allowed everywhere like `_queryId`.
  "refreshInterval",
]);

// Passthrough container types: raw-HTML-style components that declare NO own
// props (only universal `style`, see widgets/div.tsx) and exist purely to group
// children. They tolerate ARBITRARY author-supplied props — documentation labels
// like `title`/`description` are common — so the unrecognized-prop check is
// skipped entirely for them (a third state beyond "unknown type" and "known type
// with a strict allow-set"). Keep in lockstep with `_PASSTHROUGH_TYPES` in
// src/fused/agent_core/widgets/validate.py.
const PASSTHROUGH_TYPES = new Set(["div"]);

// --------------------------------------------------------------- node + props
export interface UINode {
  type: string;
  props?: Record<string, unknown>;
  children?: UINode[] | UINode | null;
}

// ----------------------------------------------------------- query-id binding
//
// Port of `withQueryIdBinding` from
// application/client/src/mcp-host/registry.ts. Rather than wrapping every
// registered renderer (openfused's registry is plain `Record<type, Renderer>`),
// we wrap at render time only for nodes the resolver stamped with `_queryId`:
// the component's `useDuckDbSqlQuery` → `useJsonUiBinding()` then sees the id and
// threads it into `bridge.sql.query(sql, { queryId })`, which the static bridge
// resolves against the server-injected rows. Nodes without `_queryId` render
// with no provider (the context default `{}` → `queryId: undefined`) and behave
// exactly as before.
function BoundNode({
  queryId,
  refreshInterval,
  children,
}: {
  queryId: string;
  refreshInterval?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <JsonUiBindingContext.Provider value={{ queryId, refreshInterval }}>
      {children}
    </JsonUiBindingContext.Provider>
  );
}

// --------------------------------------------------------------- style coerce
//
// The json-ui contract is `style: string` (_universal.ts) and every widget reads
// it through `parseStyle(props.style)`. `parseStyle` calls `.split(";")` on its
// input, so an agent-authored config that emits a React-style OBJECT
// (`{display:"flex"}`) makes `parseStyle` THROW `style.split is not a function`.
// Unguarded, that throw unmounts the whole widget tree — the black-screen bug
// (ITEM-11878). Normalizing an object `style` to the CSS string `parseStyle`
// expects, HERE at the single render choke point, keeps every widget unchanged
// and lets a malformed widget render instead of crashing the app.
const kebabCase = (s: string): string =>
  s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** Serialize a React-style object to the kebab-case CSS string `parseStyle` digests. */
export function styleObjectToCss(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${kebabCase(k)}: ${String(v)}`)
    .join("; ");
}

/**
 * Return `props` with an object `style` coerced to a CSS string (string/absent
 * `style` is left untouched). Shallow-copies only when it rewrites, so the
 * original config object is never mutated.
 */
function coerceStyleProp(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const style = props.style;
  if (style && typeof style === "object" && !Array.isArray(style)) {
    return { ...props, style: styleObjectToCss(style as Record<string, unknown>) };
  }
  return props;
}

// ------------------------------------------------------------ unknown / leaves
function UnknownComponent({ type }: { type: string }): React.ReactElement {
  return (
    <div className="ofw-unknown" role="alert">
      unknown component: {type}
    </div>
  );
}

// Soft advisory shown ALONGSIDE a rendered widget when it carries props the live
// bundle does not recognize (a typo, a stale/app-only prop). It never replaces the
// widget — the component still renders whatever it recognized; this is a warning,
// not a hard gate. Amber (--ofw-accent) treatment, distinct from the danger-red
// unknown-type placeholder.
function PropWarning({
  type,
  props,
}: {
  type: string;
  props: string[];
}): React.ReactElement {
  return (
    <div className="ofw-warning" role="alert">
      {type}: ignored unrecognized prop{props.length > 1 ? "s" : ""}:{" "}
      {props.join(", ")}
    </div>
  );
}

/** Prop names on `props` not in the type's allow-set (best-effort: unknown type → none). */
function unrecognizedProps(
  type: string,
  props: Record<string, unknown>,
): string[] {
  // Passthrough container → accepts any prop, never warn.
  if (PASSTHROUGH_TYPES.has(type)) return [];
  const allowed = ALLOWED_PROPS[type];
  // No entry for this type → treat as all-allowed (best-effort, don't warn).
  if (!allowed) return [];
  const allowSet = new Set(allowed);
  return Object.keys(props).filter(
    (k) => !allowSet.has(k) && !ALWAYS_ALLOWED.has(k),
  );
}

// `display:contents` marker carrying the node's stable path (json-ui-comments.md
// §9). Generates no box, so layout is identical; the page-level CommentsLayer
// hit-tests `[data-ofw-node]` and positions pins off the node's children rect.
const DISPLAY_CONTENTS = { display: "contents" } as const;

// ----------------------------------------------------------- children walk
function renderChildren(
  children: UINode["children"],
  basePath: string,
): React.ReactNode[] {
  if (children == null) return [];
  const arr = Array.isArray(children) ? children : [children];
  return arr.map((child, i) => (
    <RenderNode
      key={`${basePath}.${i}`}
      node={child}
      path={`${basePath}.${i}`}
    />
  ));
}

// --------------------------------------------------------------- node renderer
/**
 * Render one node into its registered component (or the unknown placeholder).
 * Builds the SINGLE `element` prop and threads `_queryId` through the binding
 * context.
 */
function NodeInner({
  node,
  path,
}: {
  node: UINode;
  path: string;
}): React.ReactElement {
  const Component: ComponentRenderer | undefined = registry[node.type];
  // Coerce an object `style` to the CSS string the widgets' `parseStyle` expects
  // (a render-tree-wide guard against the black-screen throw — see coerceStyleProp).
  const props = coerceStyleProp(node.props ?? {});
  const childNodes = renderChildren(node.children, path);

  if (!Component) return <UnknownComponent type={node.type} />;

  // NEVER spread `element`. The component reads `element.props`.
  const element = {
    type: node.type,
    props,
    children: childNodes,
  };
  const rendered = <Component element={element} />;

  // Soft prop check — only for KNOWN types (unknown types already early-returned
  // above, so we never double-warn). Warn ALONGSIDE the widget, never replacing it.
  const extras = unrecognizedProps(node.type, props);
  const withWarning =
    extras.length > 0 ? (
      <>
        <PropWarning type={node.type} props={extras} />
        {rendered}
      </>
    ) : (
      rendered
    );

  const queryId = props._queryId;
  if (typeof queryId === "string" && queryId !== "") {
    // Thread `refreshInterval` alongside `_queryId` so SDK 0.4.0's
    // `useDuckDbSqlQuery` (which reads it off `useJsonUiBinding()`) can drive its
    // live-refresh poll. Without this the store's timer refetches but the hook
    // never re-reads, so the node never repaints.
    const refreshInterval =
      typeof props.refreshInterval === "number" ? props.refreshInterval : undefined;
    return (
      <BoundNode queryId={queryId} refreshInterval={refreshInterval}>
        {withWarning}
      </BoundNode>
    );
  }
  return withWarning;
}

/**
 * Render a single node. Defensive against malformed nodes (unknown placeholder,
 * never a throw).
 */
export function RenderNode({
  node,
  path = "0",
}: {
  node: UINode;
  path?: string;
}): React.ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return (
      <UnknownComponent
        type={String((node as { type?: unknown })?.type ?? "?")}
      />
    );
  }
  // The `data-ofw-node` marker carries the node's stable path for page-level
  // comment anchoring (display:contents → it generates no layout box).
  return (
    <div data-ofw-node={path} style={DISPLAY_CONTENTS}>
      <NodeInner node={node} path={path} />
    </div>
  );
}

/**
 * Render a whole widget config tree under the static bridge. The bridge carries
 * the reactive params store + the server-resolved data store; every component
 * reaches host state through it via SDK hooks only.
 */
export function RenderTree({
  config,
  bridge,
  children,
}: {
  config: UINode;
  bridge: FusedWidgetBridge;
  /** Page-level siblings rendered UNDER the bridge (e.g. the comments layer). */
  children?: React.ReactNode;
}): React.ReactElement {
  // One bus per tree; stable across re-renders (only config changes replace it).
  const busRef = React.useRef(createLoadingBus());
  const bus = busRef.current;

  // Wrap the bridge's edge callbacks to feed the loading bus. Memoised on
  // `bridge` identity: a genuinely new bridge (config change) gets new
  // wrappers; the bus ref stays stable throughout.
  const trackedBridge = React.useMemo<FusedWidgetBridge>(() => ({
    ...bridge,
    edges: {
      startLoading: () => { bus.start(); bridge.edges.startLoading(); },
      stopLoading:  () => { bus.stop();  bridge.edges.stopLoading();  },
    },
  }), [bridge, bus]);

  return (
    <LoadingBusContext.Provider value={bus}>
      <FusedWidgetBridgeContext.Provider value={trackedBridge}>
        <RenderNode node={config} />
        {children}
      </FusedWidgetBridgeContext.Provider>
    </LoadingBusContext.Provider>
  );
}
