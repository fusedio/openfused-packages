// widgets/color-input.tsx — a color swatch field that writes its hex string
// value to a `param` (debounced), or works as a regular local color input when
// no `param` is given. Form-ready: inside a Form it defers broadcast to submit.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm<string>({ param, defaultValue })`,
// styles via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag the generator reads.
//
// Prop contract is a strict SUBSET of the application's color-input
// (application/client/src/udfrun/json-ui/components/color-input.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props. The universal `css` is read off
// `element.props.style` (the `css -> style` rename lands in ./_universal.ts
// globally; this file must NOT redeclare `style`). `param` is OPTIONAL to match
// the app. `defaultValue` (e.g. "#E8FF59") and `disabled` are app props mapped
// onto the native <input type="color">. `showValue` renders the hex string next
// to the swatch (an openfused-local convenience; the app shows the value in its
// picker trigger and uses `format`/`showAlpha`, which are out of scope here).
//
// The host-state seam is the SDK's `useFusedParamWithForm` (Form-aware twin of
// useFusedParam): `value`/`setValue` is the two-way canvas binding;
// `broadcastDefaultValue: true` seeds `defaultValue` on mount iff no canvas
// value exists. Inside a Form the broadcast defers to submit.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   `format` (rgb/hsl/hsb), `showAlpha`, `readOnly`, the full popover
//   ColorPicker (area/hue/alpha/eyedropper) and color-string parsing — openfused
//   uses the native hex color input and broadcasts its "#rrggbb" string.

import { z } from "zod";
import {
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's ColorInputPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`. `format`/`showAlpha`/`readOnly` are omitted.
export const colorInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local color input.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the color input."),
    defaultValue: z
      .string()
      .optional()
      .describe(
        'Initial hex color value seeded into the param (e.g. "#E8FF59").',
      ),
    showValue: z
      .boolean()
      .optional()
      .describe("Whether to render the hex string next to the swatch."),
    disabled: z
      .boolean()
      .optional()
      .describe("Whether the picker is disabled."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type ColorInputProps = z.infer<typeof colorInputProps>;

// -------------------------------------------------------------------- component
function ColorInput({ element }: ComponentRenderProps<ColorInputProps>) {
  const { param, label, defaultValue, showValue, disabled } = element.props;
  const style = (element.props as { style?: string }).style;

  // The Form-aware SDK hook two-way binds the named param as a hex string.
  // `broadcastDefaultValue: true` seeds `defaultValue` on mount iff no canvas
  // value exists. Inside a Form the broadcast defers to submit.
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: defaultValue ?? "#000000",
    broadcastDefaultValue: true,
    debounceMs: 100,
  });

  const id = `ofw-color-${param ?? "local"}`;

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          id={id}
          className="ofw-color"
          type="color"
          value={value ?? "#000000"}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
        {showValue ? (
          <span style={{ fontFamily: "monospace", fontSize: "12px" }}>
            {value}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: ColorInput,
    props: colorInputProps,
    description:
      "Color input with optional param sync (debounced); local color input when no param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
