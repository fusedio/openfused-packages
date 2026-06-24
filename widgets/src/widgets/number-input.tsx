// widgets/number-input.tsx — numeric field that writes its number value to a
// `param` (debounced), or works as a regular local number input when no `param`
// is given. Form-ready: inside a Form it defers broadcast to submit.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm<number>({ param, defaultValue })`,
// styles via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag the generator reads.
//
// Per spec/ui/ui-architecture.md §6.2 this widget is split into (a) a dumb control —
// the shared `Input` primitive from `@kit` (`@fusedio/ui-kit`, props in / JSX
// out, no param store) — and (b) this thin param-binding wrapper that owns the
// `defineComponent` declaration + the `useFusedParamWithForm` host-state seam. The
// leaf `<input type="number">` (formerly the bespoke `ofw-input` class) now renders
// through the kit primitive; the `defineComponent` block is unchanged so the
// generator keeps emitting byte-identical `components.json`.
//
// Prop contract is a strict SUBSET of the application's number-input
// (application/client/src/udfrun/json-ui/components/number-input.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props. The universal `css` is read off
// `element.props.style` (the `css -> style` rename lands in ./_universal.ts
// globally; this file must NOT redeclare `style`). `param` is OPTIONAL to match
// the app. `placeholder`, `defaultValue` (number), `min`, `max`, `step`, and
// `disabled` are app props mapped onto the native <input type="number">.
//
// The host-state seam is the SDK's `useFusedParamWithForm` (Form-aware twin of
// useFusedParam): `value`/`setValue` is the two-way canvas binding; `setValue`
// is called with `Number(e.target.value)` so the param holds a number, not a
// string. `broadcastDefaultValue: true` seeds the numeric `defaultValue` on
// mount iff no canvas value exists. Inside a Form, broadcast defers to submit.
//
// A MINIMAL draft buffer is reproduced (the field holds the raw string while
// editing and only commits a FINITE number) so clearing or partial typing never
// broadcasts a NaN param — the bug the app's fuller draft buffer also avoids.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   `readOnly`, range `validate`/`preprocess` guards, and the min<=max refine —
//   openfused relies on the native number input's min/max/step.

import React from "react";
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
// A strict subset of the application's NumberInputPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`. `readOnly` is intentionally omitted.
export const numberInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter name to two-way sync with, or form field name if inside a Form. If omitted, works as a regular local number input.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the number input."),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text shown while empty."),
    defaultValue: z
      .number()
      .optional()
      .describe("Initial numeric value seeded into the param on mount."),
    min: z.number().optional().describe("Minimum allowed value."),
    max: z.number().optional().describe("Maximum allowed value."),
    step: z.number().optional().describe("Step increment (default 1)."),
    disabled: z.boolean().optional().describe("Whether the input is disabled."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type NumberInputProps = z.infer<typeof numberInputProps>;

// -------------------------------------------------------------------- component
function NumberInput({ element }: ComponentRenderProps<NumberInputProps>) {
  const {
    param,
    label,
    placeholder,
    defaultValue,
    min,
    max,
    step = 1,
    disabled,
  } = element.props;
  const style = (element.props as { style?: string }).style;

  // The Form-aware SDK hook two-way binds the named param as a number.
  // `setValue(Number(...))` keeps the param numeric. Inside a Form the broadcast
  // defers to submit; outside a form it is plain useFusedParam.
  const { value, setValue } = useFusedParamWithForm<number>({
    param,
    defaultValue: typeof defaultValue === "number" ? defaultValue : 0,
    broadcastDefaultValue: true,
    debounceMs: 300,
  });

  const id = `ofw-number-${param ?? "local"}`;

  // Minimal draft buffer so transient/empty input (e.g. clearing the field, or
  // "-" / "1." mid-typing) does NOT broadcast a NaN param. While editing, the
  // raw string is held locally; only a FINITE parsed number is committed via
  // setValue. On blur the draft is dropped so the field re-syncs to the
  // canonical (possibly externally-updated) numeric value. `Number("")` is NaN,
  // so the guard also covers the empty case.
  const [draft, setDraft] = React.useState<string | null>(null);
  const display =
    draft !== null
      ? draft
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <Input
        id={id}
        type="number"
        placeholder={placeholder}
        value={display}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw !== "" && Number.isFinite(n)) setValue(n);
        }}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: NumberInput,
    props: numberInputProps,
    description:
      "Numeric input with optional param sync (debounced); local number input when no param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
