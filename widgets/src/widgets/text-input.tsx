// widgets/text-input.tsx — text field that writes its string value to a `param`
// (debounced), or works as a regular local input when no `param` is given.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParam({ param, defaultValue })`, styles via
// `parseStyle(element.props.style)`, and default-exports `defineComponent({...})`
// PLUS the `writesParam: true` flag the generator reads.
//
// Prop contract is a strict SUBSET of the application's text-input
// (application/client/src/udfrun/json-ui/components/text-input.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props. The component-specific renames from
// the openfused legacy names are:
//   • `default`  -> `defaultValue`   (initial value seeded into the param)
//   • `debounce` -> `debounceMs`     (debounce delay; app prop name)
// and the universal `css` is read off `element.props.style` (the universal
// `css -> style` rename lands in ./_universal.ts globally; this file must NOT
// redeclare `style`). `param` is OPTIONAL to match the app (regular-input mode
// when omitted — the SDK hook explicitly degrades to local state for an
// undefined/empty `param`). `disabled` and `type` are app props mapped straight
// onto the native <input>.
//
// The host-state seam is the SDK's `useFusedParamWithForm` (the form-aware
// variant of `useFusedParam`): outside a form it behaves identically to
// `useFusedParam`; inside a `form` it becomes local state and mirrors its value
// into the form's field store for collective submit (see form.tsx). It IS the
// old machinery:
//   • `value`/`setValue` is the two-way canvas binding — `setValue` updates the
//     local value instantly (for responsive typing) and broadcasts on a debounce
//     so dependent queries don't fire on every keystroke;
//   • `debounceMs` is the old `debounce` prop;
//   • `broadcastDefaultValue: true` seeds `defaultValue` into the param on mount
//     iff no canvas value exists (empty-string defaults are guarded internally
//     and never broadcast).
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   • `submitMode` (type|focus|submit) — openfused implements the debounced
//     "type" subset only; a config setting submitMode=focus|submit pastes
//     without error but behaves as type-mode here;
//   • the inline Submit button, draft/blur-commit state, and
//     `useParamSubstitution` on defaultValue. (Form registration via
//     `useFusedParamWithForm` IS now reproduced — see form.tsx.)

import { z } from "zod";
import {
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Input } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's TextInputPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in
// via `.extend(UNIVERSAL_PROPS.shape)`. `submitMode` is intentionally omitted.
export const textInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local input.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed beside/above the input."),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text shown while empty."),
    defaultValue: z
      .string()
      .optional()
      .describe("Initial value seeded into the param on mount."),
    debounceMs: z
      .number()
      .optional()
      .describe(
        "Milliseconds to wait after typing before broadcasting the param (default 300).",
      ),
    disabled: z.boolean().optional().describe("Whether the input is disabled."),
    type: z
      .string()
      .optional()
      .describe('HTML input type (e.g. "text", "email", "password").'),
  })
  .extend(UNIVERSAL_PROPS.shape);

type TextInputProps = z.infer<typeof textInputProps>;

// -------------------------------------------------------------------- component
function TextInput({ element }: ComponentRenderProps<TextInputProps>) {
  const {
    param,
    label,
    placeholder,
    defaultValue,
    debounceMs,
    disabled,
    type,
  } = element.props;
  const style = (element.props as { style?: string }).style;

  // The SDK hook two-way binds the named param: `setValue` updates locally for
  // instant typing and broadcasts on the debounce. `broadcastDefaultValue: true`
  // seeds `defaultValue` on mount iff the param is absent. With no `param` the
  // hook degrades to plain local state (no broadcast).
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: defaultValue ?? "",
    broadcastDefaultValue: true,
    debounceMs: typeof debounceMs === "number" ? debounceMs : 300,
  });

  const id = `ofw-text-${param ?? "local"}`;

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <Input
        id={id}
        type={type ?? "text"}
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
    component: TextInput,
    props: textInputProps,
    description:
      "Text input with optional param sync (debounced); local input when no param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
