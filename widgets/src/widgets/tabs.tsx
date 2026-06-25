// widgets/tabs.tsx — a tabbed container: a label bar over one visible child panel.
//
// A reusable layout primitive (OpenFused-owned) for composing tabbed surfaces from
// other components — e.g. the agent UI (Overview / Runs / Instructions) or any
// dashboard section set. The `tabs` prop lists the labels; `element.children` are
// the panels in the SAME order (one child per tab). Only the active panel renders;
// tab state is local React state. Authored against `@fusedio/widget-sdk` + ui-kit,
// like the other containers (div/form).

import React from "react";
import { z } from "zod";
import { parseStyle, defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

export const tabsProps = z
  .object({
    tabs: z
      .array(z.object({ label: z.string() }))
      .optional()
      .default([])
      .describe(
        "The tab labels, in order. Each maps to the child panel at the same index (child 0 → tab 0).",
      ),
    defaultTab: z
      .number()
      .optional()
      .default(0)
      .describe("Index of the tab shown first (0-based)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type TabsProps = z.infer<typeof tabsProps>;

function Tabs({ element }: ComponentRenderProps<TabsProps>) {
  const { tabs = [], defaultTab = 0, style } = element.props;
  const panels = React.Children.toArray(element.children as React.ReactNode);
  // Labels come from the `tabs` prop; if fewer labels than panels, the extra
  // panels are unreachable (author error) — clamp the active index to a real tab.
  const count = Math.max(tabs.length, 0);
  const maxIndex = Math.max(panels.length - 1, 0);
  const [active, setActive] = React.useState(() =>
    Math.min(Math.max(defaultTab, 0), Math.max(count - 1, 0)),
  );
  // The shown panel is `active` clamped into the panel range. Highlight the SAME
  // index so the selected tab and the visible panel never disagree — even when
  // there are more labels than panels (author error): an orphan label selects the
  // last panel rather than highlighting one tab while showing another's content.
  const shown = Math.min(active, maxIndex);

  return (
    <div className="ofw-tabs" style={parseStyle(style)}>
      <div
        role="tablist"
        className="-mx-1 flex flex-wrap items-center gap-1 border-b border-border"
      >
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === shown}
            data-active={i === shown || undefined}
            onClick={() => setActive(Math.min(i, maxIndex))}
            className={
              "relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors " +
              (i === shown
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ofw-tabs__panel pt-4">{panels[shown] ?? null}</div>
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Tabs,
    props: tabsProps,
    description:
      "Tabbed container: a label bar (the `tabs` prop) over one visible child panel. Each child is the panel for the tab at the same index; only the active panel renders. Local tab state.",
    hasChildren: true,
  }),
  writesParam: false,
};

export default definition;
