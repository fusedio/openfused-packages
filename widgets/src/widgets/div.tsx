// widgets/div.tsx — a plain <div> container, styled entirely via `style`.
//
// Authored ONLY against `@fusedio/widget-sdk`, mirroring the verified exemplars
// (stat.tsx / bar-chart.tsx): reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, styles via `parseStyle(props.style)`, and
// default-exports `defineComponent({...})` + the `writesParam` flag.
//
// Aligns the openfused container to the application `div` component
// (application/client/src/udfrun/json-ui/components/div.tsx). The app `div` has
// exactly ONE own prop — `style`, which is the UNIVERSAL inline-style string —
// so this component declares ZERO component-specific props: the only authorable
// styling input is the universal `style` prop folded in from UNIVERSAL_PROPS.
//
// The app's DivRenderer renders `<div className="min-w-0 flex flex-col">`, i.e. a
// default flex column with `min-width: 0`. openfused must NOT import baseui or
// @json-render/react; that default layout is reproduced by the `ofw-div` CSS
// class (min-width:0; display:flex; flex-direction:column), over which the user's
// authored `style` string merges via `parseStyle`. Child nodes are read off
// `element.children` (already walked by the renderer) and passed through unchanged.

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
// Mirrors src/fused/agent_core/widgets/schema/div.json's prop set exactly: no own
// props, only the universal `style` prop. required: [].
export const divProps = z.object({}).extend(UNIVERSAL_PROPS.shape);

type DivProps = z.infer<typeof divProps>;

// -------------------------------------------------------------------- component
function Div({ element }: ComponentRenderProps<DivProps>) {
  const { style } = element.props;

  return (
    <div className="ofw-div" style={parseStyle(style)}>
      {element.children as React.ReactNode}
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Div,
    props: divProps,
    description:
      "Container for grouping child elements; defaults to a flex column, fully style-driven.",
    hasChildren: true,
  }),
  writesParam: false,
};

export default definition;
