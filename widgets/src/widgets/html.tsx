// widgets/html.tsx — raw-HTML escape hatch (scripts execute).
//
// A fan-out display component mirroring the stat/text/bar-chart exemplars.
// Authored ONLY against `@fusedio/widget-sdk`: reads `element.props`, declares
// real-zod props `.extend(UNIVERSAL_PROPS.shape)`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// plus the `writesParam` flag.
//
// Prop contract is a strict SUBSET of the application's html
// (application/client/src/udfrun/json-ui/components/html.tsx): identical prop
// NAMES/TYPES/SEMANTICS, fewer behaviours. The component-specific rename from
// the openfused legacy name is:
//   • `content` -> `value`   (the raw HTML value; the app has no `content` prop)
// and the universal `css` is read off `element.props.style` (the universal
// `css -> style` rename lands in ./_universal.ts globally; this file must NOT
// redeclare `style`).
//
// Renderer body preserved exactly — raw HTML, fully live:
//
//   • innerHTML defaults to the empty string when `value` is absent;
//   • innerHTML-inserted <script> nodes are inert per the HTML spec, so after
//     injection we re-create each <script> (copying its attributes + text body),
//     which makes the browser run it (inline AND src=);
//   • scripts share the dashboard's window/DOM — for an isolated document use
//     the `iframe` component instead.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   • the app renders into a sandboxed iframe (sandbox="allow-scripts", srcDoc
//     with a canvas-helper script) and relays iframe postMessage to the param
//     BroadcastChannel for two-way fusedCanvas.setParam/clearParam. openfused
//     renders inline in the page DOM and exposes no fusedCanvas bridge;
//   • `$param_name` / `{{udf_name}}` substitution (the app's useParamSubstitution)
//     — the SQL/param grammar is owned by the SDK/resolver layer, so openfused
//     reads `element.props.value` verbatim.
//
// Identical rendering is NOT required — identical CONFIG semantics IS. A config
// that uses `$param`/`{{udf}}` or `fusedCanvas.setParam(...)` pastes cleanly
// (same prop name `value`) but those bridges are not reproduced here.
//
// Trust model: dashboards are trusted, locally-authored content (same trust
// model as the UDFs that produce them); do not feed this remote or
// user-generated content.

import React from "react";
import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's HtmlPropsSchema: identical names/types/
// semantics (`value`), plus the universal `style` prop folded in
// via `.extend(UNIVERSAL_PROPS.shape)`.
export const htmlProps = z
  .object({
    value: z
      .string()
      .default("")
      .describe(
        "Raw HTML value. Supports $param_name placeholders for dynamic values and {{udf_name}} to inline HTML template or stringified UDF output.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type HtmlProps = z.infer<typeof htmlProps>;

// -------------------------------------------------------------------- component
function Html({ element }: ComponentRenderProps<HtmlProps>) {
  const { value } = element.props;
  const style = (element.props as { style?: string }).style;
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = value ?? "";
    // innerHTML-inserted scripts are inert per the HTML spec; re-create each
    // <script> node so the browser executes it (inline and src=).
    for (const old of Array.from(el.querySelectorAll("script"))) {
      const script = document.createElement("script");
      for (const attr of Array.from(old.attributes)) {
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = old.textContent;
      old.replaceWith(script);
    }
  }, [value]);

  return (
    <div className="ofw-html" style={parseStyle(style)} ref={ref} />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Html,
    props: htmlProps,
    description:
      "Raw-HTML escape hatch; the value is injected into the page DOM and any inline scripts execute. Trusted authors only.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
