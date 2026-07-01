// widgets/collapsible.tsx — a disclosure container: an always-visible summary
// header over a panel of child components that is COLLAPSED by default.
//
// An openfused/agent_core-owned LAYOUT primitive (no Fused application parity,
// like `tabs`) for taming long content. The architect's spec-review gate leads
// with a short bullet summary and tucks the full plan body + spec diffs inside a
// `collapsible` so the human is not hit with a wall of text — they read the
// 3–4 point summary, then expand a section only when they want the detail.
// `element.children` are the panel body; `summary` is the always-visible header
// label. Closed unless `defaultOpen` is set. Local open/closed state — never a
// param (writesParam: false), so it is safe to nest anywhere.
//
// Authored against `@fusedio/widget-sdk` + the shared `@kit` ui-kit `Collapsible`
// (Radix) primitive and its `ChevronRight` icon (icons come from @kit, never
// lucide-react directly — bundle allowlist rule).

import React from "react";
import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  ChevronRight,
} from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
export const collapsibleProps = z
  .object({
    summary: z
      .string()
      .optional()
      .default("Details")
      .describe(
        'The always-visible header label (e.g. "Full spec", "See detail"). Clicking it toggles the panel open/closed.',
      ),
    defaultOpen: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether the panel is expanded on first render. Defaults to false (collapsed) — the point of this container is to hide detail until the human asks for it.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type CollapsibleWidgetProps = z.infer<typeof collapsibleProps>;

// -------------------------------------------------------------------- component
function CollapsibleWidget({
  element,
}: ComponentRenderProps<CollapsibleWidgetProps>) {
  const { summary = "Details", defaultOpen = false } = element.props;
  // `style` is the universal inline-style prop folded in via UNIVERSAL_PROPS —
  // read it off props the same way checkbox-group does, without redeclaring it.
  const style = (element.props as { style?: string }).style;
  const [open, setOpen] = React.useState<boolean>(!!defaultOpen);
  const children = React.Children.toArray(element.children as React.ReactNode);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="ofw-collapsible overflow-hidden rounded-md border border-border bg-card shadow-sm"
      style={parseStyle(style)}
    >
      <CollapsibleTrigger
        className={
          "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/60 " +
          (open ? "border-b border-border bg-accent/30" : "")
        }
      >
        <ChevronRight
          className={
            "h-4 w-4 shrink-0 text-foreground/70 transition-transform duration-150 " +
            (open ? "rotate-90" : "")
          }
        />
        <span className="flex-1">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3.5 py-3">
        <div className="ofw-collapsible__panel flex flex-col gap-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: CollapsibleWidget,
    props: collapsibleProps,
    description:
      "Disclosure container: an always-visible `summary` header over a panel of child components, COLLAPSED by default (set `defaultOpen: true` to start expanded). Use it to lead with a short summary and hide long detail (plan bodies, spec diffs, dense text) until the human expands it. Local open/closed state; writes no param, so it nests safely anywhere.",
    hasChildren: true,
  }),
  writesParam: false,
};

export default definition;
