// widgets/datetime-input.tsx — a date, time, or local-datetime field that writes
// its string value to a `param` (debounced), or works as a regular local input
// when no `param` is given. Form-ready: inside a Form it defers broadcast.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm<string>({ param, defaultValue })`,
// styles via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag the generator reads.
//
// Prop contract is a strict SUBSET of the application's datetime-input
// (application/client/src/udfrun/json-ui/components/datetime-input.tsx):
// identical prop NAMES/TYPES/SEMANTICS, fewer props. The universal `css` is read
// off `element.props.style` (the `css -> style` rename lands in ./_universal.ts
// globally; this file must NOT redeclare `style`). `param` is OPTIONAL to match
// the app. `mode` (date|time|datetime, default "date"), `defaultValue`, `min`,
// `max`, and `disabled` are app props. The native input `type` is derived from
// `mode`: date -> "date", time -> "time", datetime -> "datetime-local". Values
// are plain strings stored without timezone conversion, matching the app.
//
// The host-state seam is the SDK's `useFusedParamWithForm` (Form-aware twin of
// useFusedParam): `value`/`setValue` is the two-way canvas binding;
// `broadcastDefaultValue: true` seeds `defaultValue` on mount iff no canvas
// value exists. Inside a Form the broadcast defers to submit.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   `step`, `readOnly`, the popover Calendar picker for date mode, and
//   `useParamSubstitution` on defaultValue — openfused uses the native
//   date/time/datetime-local input across all three modes.

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
// A strict subset of the application's DateTimeInputPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`. `step`/`readOnly` are intentionally omitted.
export const datetimeInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local datetime input.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the datetime input."),
    defaultValue: z
      .string()
      .optional()
      .describe("Initial string value seeded into the param on mount."),
    mode: z
      .enum(["date", "time", "datetime"])
      .optional()
      .describe(
        "Input mode. Use date for YYYY-MM-DD, time for HH:mm, or datetime for YYYY-MM-DDTHH:mm (default date).",
      ),
    min: z
      .string()
      .optional()
      .describe("Minimum allowed date, time, or datetime string."),
    max: z
      .string()
      .optional()
      .describe("Maximum allowed date, time, or datetime string."),
    disabled: z.boolean().optional().describe("Whether the input is disabled."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type DatetimeInputProps = z.infer<typeof datetimeInputProps>;

// -------------------------------------------------------------------- component
function DatetimeInput({ element }: ComponentRenderProps<DatetimeInputProps>) {
  const {
    param,
    label,
    defaultValue,
    mode = "date",
    min,
    max,
    disabled,
  } = element.props;
  const style = (element.props as { style?: string }).style;

  // The Form-aware SDK hook two-way binds the named param as a string.
  // `broadcastDefaultValue: true` seeds `defaultValue` on mount iff no canvas
  // value exists. Inside a Form the broadcast defers to submit.
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: defaultValue ?? "",
    broadcastDefaultValue: true,
    debounceMs: 300,
  });

  const inputType =
    mode === "time" ? "time" : mode === "datetime" ? "datetime-local" : "date";
  const id = `ofw-datetime-${param ?? "local"}`;

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <input
        id={id}
        className="ofw-input"
        type={inputType}
        value={value ?? ""}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: DatetimeInput,
    props: datetimeInputProps,
    description:
      "Date, time, or datetime input with optional param sync (debounced); local input when no param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
