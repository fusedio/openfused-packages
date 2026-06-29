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

import { registry, type ComponentRenderer } from "./widgets";

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
  children,
}: {
  queryId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <JsonUiBindingContext.Provider value={{ queryId }}>
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

  const queryId = props._queryId;
  if (typeof queryId === "string" && queryId !== "") {
    return <BoundNode queryId={queryId}>{rendered}</BoundNode>;
  }
  return rendered;
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
  return (
    <FusedWidgetBridgeContext.Provider value={bridge}>
      <RenderNode node={config} />
      {children}
    </FusedWidgetBridgeContext.Provider>
  );
}
