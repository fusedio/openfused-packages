// widgets/diff.tsx — render a textual diff. OpenFused-owned primitive (no app
// parity). Built for "diff of markdown specs": pass two versions (`before` /
// `after`) and the widget renders a colored line-level diff. A precomputed
// unified-diff string (`diff`) is also accepted for the git path.
//
// Thin wrapper over the shared `DiffView` (../diff-view) — the SAME renderer the
// app spec-review thread uses (full consolidation). Authored only against
// `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, styles via `parseStyle(props.style)`, and
// default-exports `defineComponent({...})` plus `writesParam: false`. Not
// data-bound and not an input.
import { z } from "zod";
import { parseStyle, defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { DiffView } from "../diff-view";

export const diffProps = z
  .object({
    before: z
      .string()
      .optional()
      .describe("Original text. A line-level diff is computed against `after`."),
    after: z
      .string()
      .optional()
      .describe("New text. A line-level diff is computed against `before`."),
    diff: z
      .string()
      .optional()
      .describe(
        "Precomputed unified-diff string (git format). Use INSTEAD of before/after when you already have a diff; rendered as-is with +/- coloring.",
      ),
    oldLabel: z.string().optional().describe("Optional label for the original side (header)."),
    newLabel: z.string().optional().describe("Optional label for the new side (header)."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type DiffProps = z.infer<typeof diffProps>;

function Diff({ element }: ComponentRenderProps<DiffProps>) {
  const { before, after, diff, oldLabel, newLabel } = element.props;
  const { style } = element.props as { style?: string };

  return (
    <DiffView
      before={before}
      after={after}
      diff={diff}
      oldLabel={oldLabel}
      newLabel={newLabel}
      style={parseStyle(style)}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Diff,
    props: diffProps,
    description:
      "Show a textual diff as colored +/- lines — e.g. the change between two markdown spec versions. Provide `before` + `after` (the diff is computed for you) OR a precomputed unified-diff string in `diff`. Not data-bound, not an input.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
