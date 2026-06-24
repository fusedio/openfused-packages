// widgets/text-area.tsx — multi-line text field that writes its string value to
// a `param` (debounced), or works as a regular local textarea when no `param`
// is given. Form-ready: inside a Form it defers broadcast to submit.
//
// A fan-out INPUT component. Split per spec/ui/ui-architecture.md §6.2 into a dumb
// control (the `@kit` `Textarea` primitive — value/onChange, no param store) and
// this thin param-binding wrapper. The wrapper reads `element.props`, declares
// real-zod props `.extend(UNIVERSAL_PROPS.shape)`, binds the param via
// `useFusedParamWithForm({ param, defaultValue })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// PLUS the `writesParam: true` flag the generator reads.
//
// Prop contract is a strict SUBSET of the application's text-area
// (application/client/src/udfrun/json-ui/components/text-area.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props. The universal `css` is read off
// `element.props.style` (the universal `css -> style` rename lands in
// ./_universal.ts globally; this file must NOT redeclare `style`). `param` is
// OPTIONAL to match the app (regular-textarea mode when omitted). `rows`,
// `placeholder`, `defaultValue`, `debounceMs`, and `disabled` are app props.
//
// The host-state seam is the SDK's `useFusedParamWithForm`, the Form-aware
// twin of `useFusedParam`:
//   • `value`/`setValue` is the two-way canvas binding — `setValue` updates the
//     local value instantly and broadcasts on a debounce;
//   • `broadcastDefaultValue: true` seeds `defaultValue` on mount iff no canvas
//     value exists (empty-string defaults are guarded internally);
//   • inside a <form> it writes to the form's field store and defers broadcast
//     until submit; outside a form it behaves EXACTLY like useFusedParam.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   `submitMode` (type|focus|submit), `maxLength`, `readOnly`, the inline Submit
//   button / draft-commit state, and `useParamSubstitution` on defaultValue —
//   openfused implements the debounced "type" subset only.

import { z } from "zod";
import {
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Textarea } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's TextAreaPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`. `submitMode`/`maxLength`/`readOnly` omitted.
export const textAreaProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local text area.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the text area."),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text shown while empty."),
    defaultValue: z
      .string()
      .optional()
      .describe("Initial value seeded into the param on mount."),
    rows: z
      .number()
      .optional()
      .describe("Number of visible text rows (default 3)."),
    debounceMs: z
      .number()
      .optional()
      .describe(
        "Milliseconds to wait after typing before broadcasting the param (default 300).",
      ),
    disabled: z
      .boolean()
      .optional()
      .describe("Whether the text area is disabled."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type TextAreaProps = z.infer<typeof textAreaProps>;

// -------------------------------------------------------------------- component
function TextArea({ element }: ComponentRenderProps<TextAreaProps>) {
  const {
    param,
    label,
    placeholder,
    defaultValue,
    rows = 3,
    debounceMs,
    disabled,
  } = element.props;
  const style = (element.props as { style?: string }).style;

  // The Form-aware SDK hook two-way binds the named param: `setValue` updates
  // locally for instant typing and broadcasts on the debounce. Inside a Form it
  // defers the broadcast to submit; outside a form it is plain useFusedParam.
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: defaultValue ?? "",
    broadcastDefaultValue: true,
    debounceMs: typeof debounceMs === "number" ? debounceMs : 300,
  });

  const id = `ofw-textarea-${param ?? "local"}`;

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <Textarea
        id={id}
        rows={rows}
        placeholder={placeholder}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: TextArea,
    props: textAreaProps,
    description:
      "Multi-line text input with optional param sync (debounced); local text area when no param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
