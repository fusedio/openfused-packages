// widgets/form.tsx — a container that collects its descendant inputs' values
// and broadcasts them to the param store ON SUBMIT (not on every keystroke).
//
// ALIGNED to the Fused application `form` component
// (application/client/src/udfrun/json-ui/components/form.tsx) at the CONFIG
// level, with one deliberate behavioural narrowing forced by openfused's
// architecture (spec/ui/json-ui-widgets-batch1.md § In scope — form):
//
//   • In the APP, SQL runs in the browser, so a chart/table inside a form
//     re-queries LIVE as you edit sibling fields. openfused has NO client
//     DuckDB — all SQL resolves server-side (spec/json-ui-data.md) — so a
//     "live" in-form query would need a server round-trip per keystroke, which
//     defeats the point of a form. openfused therefore adopts SUBMIT-TO-APPLY
//     semantics: field edits stay local until the user presses submit, at which
//     point the values broadcast and the normal reactivity path re-resolves the
//     dependent queries (spec/ui/json-ui.md § React). Same config, same final
//     result, different timing.
//
// HOW IT WORKS (the SDK already ships the machinery):
//   • A fresh `FormParamsStore` (createFormParamsStore) is created once per Form
//     instance. The Form provides `FormContext = { store, isInForm: true }` to
//     its subtree.
//   • Descendant inputs authored with `useFusedParamWithForm` (text-input,
//     dropdown, slider, the batch-1 inputs, …) detect the FormContext: while in
//     a form they become pure LOCAL state — they do NOT broadcast to the
//     canvas — and mirror their live value into `store.setField(name, value)`.
//   • On submit the Form reads `store.getAll()` and broadcasts via the bridge:
//       – TOP-LEVEL `param` SET  → all fields bundled into ONE JSON object on
//         that single param (`{ name: "...", city: "..." }`).
//       – NO top-level `param`   → each field broadcasts to its OWN param
//         individually.
//     This preserves the application's top-level-`param` gotcha byte-for-byte.
//
// SUBMIT CONTROL: openfused's `button` widget is the feedback-session reply
// primitive (it reports an action over the session/parley channel and writes
// NOTHING to params — see button.tsx), so it cannot drive a form submit without
// conflating two concepts. The Form therefore renders its OWN submit button
// (`submitLabel`, default "Submit"). This is a behavioural subset, not extra
// surface: a pasted app config that relied on a child submit button still
// renders; openfused just owns the submit affordance.
//
// Authored ONLY against `@fusedio/widget-sdk`: reads `element.props`, declares
// real-zod props `.extend(UNIVERSAL_PROPS.shape)`, styles via
// `parseStyle(props.style)`, broadcasts through `useFusedWidgetBridge().params`,
// and default-exports `defineComponent({...})` + the `writesParam` flag.

import React from "react";
import { z } from "zod";
import {
  createFormParamsStore,
  FormContext,
  useFusedWidgetBridge,
  parseStyle,
  defineComponent,
  type FormParamsStore,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's form contract — identical
// names/types/semantics:
//   • `param`       — OPTIONAL. When set, submit bundles all fields into ONE
//                     JSON object on this param; when absent, each field
//                     broadcasts to its own param.
//   • `submitLabel` — openfused's own submit-button caption (default "Submit").
//   + the universal `style` prop.
//
// NOTE: form declares a `param` but NO `defaultValue`, so it is NOT an input
// (it doesn't two-way bind a single param) — `writesParam: false`, and the
// generator's param+defaultValue lint is not triggered.
export const formProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "If set, on submit all child field values are bundled into a single JSON object and broadcast to this one param. If omitted, each child field broadcasts to its own param individually.",
      ),
    submitLabel: z
      .string()
      .optional()
      .describe('Text for the form\'s submit button. Default "Submit".'),
  })
  .extend(UNIVERSAL_PROPS.shape);

type FormProps = z.infer<typeof formProps>;

// -------------------------------------------------------------------- component
function Form({ element }: ComponentRenderProps<FormProps>) {
  const { param, submitLabel } = element.props;
  const style = (element.props as { style?: string }).style;

  const bridge = useFusedWidgetBridge();

  // One field store per Form instance (created once, never recreated).
  const storeRef = React.useRef<FormParamsStore | null>(null);
  if (storeRef.current === null) storeRef.current = createFormParamsStore();
  const store = storeRef.current;

  // Stable context value so the subtree doesn't churn on every Form re-render.
  const contextValue = React.useMemo(
    () => ({ store, isInForm: true }),
    [store],
  );

  const handleSubmit = React.useCallback(() => {
    const all = store.getAll();
    if (typeof param === "string" && param !== "") {
      // Bundle every field into a single JSON object on the form's param.
      bridge.params.set(param, JSON.stringify(all));
    } else {
      // Broadcast each field to its own param individually.
      for (const [name, value] of Object.entries(all)) {
        if (!name) continue;
        bridge.params.set(name, value);
      }
    }
  }, [store, param, bridge]);

  // Default layout: a flex column (like the app form / div), user `style` merges
  // OVER it via parseStyle. Inline styles keep the component self-contained (no
  // new shared CSS); the submit button reuses the existing ofw-btn classes.
  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minWidth: 0,
    ...parseStyle(style),
  };

  return (
    <FormContext.Provider value={contextValue}>
      <div className="ofw-form" style={containerStyle}>
        {element.children as React.ReactNode}
        <button
          type="button"
          className="ofw-btn ofw-btn--primary"
          style={{ alignSelf: "flex-start", marginTop: "4px" }}
          onClick={handleSubmit}
        >
          {submitLabel || "Submit"}
        </button>
      </div>
    </FormContext.Provider>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Form,
    props: formProps,
    description:
      "Form container that collects its descendant inputs and broadcasts them ON SUBMIT. With a top-level param, all fields are bundled into one JSON object on that param; without one, each field broadcasts to its own param. Renders its own submit button (submitLabel). Submit-to-apply: dependent queries re-resolve after submit, not live while typing.",
    hasChildren: true,
  }),
  writesParam: false,
};

export default definition;
