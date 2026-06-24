// widgets/slider.tsx — numeric range input that writes a Number to a param (INPUT).
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParam({ param, defaultValue })`, styles via
// `parseStyle(props.style)`, and default-exports `defineComponent({...})` PLUS
// the `writesParam: true` flag the generator reads.
//
// PROP CONTRACT is a strict SUBSET of the application slider
// (client/src/udfrun/json-ui/components/slider.tsx). Names/types/semantics are
// IDENTICAL to the app; openfused simply implements fewer props:
//   • `param`        — optional (omitted ⇒ plain local slider; app: optional).
//   • `label`        — optional caption (app: optional).
//   • `min`          — optional, default 0 (app: z.number().optional().default(0)).
//   • `max`          — optional, default 100 (app: z.number().optional().default(100)).
//   • `step`         — optional, default 1 (app: z.number().optional().default(1)).
//   • `defaultValue` — optional, default 0 (app: z.number().optional().default(0)).
//                      Renamed from openfused's former `default`.
//   • `style`        — the UNIVERSAL inline-CSS prop (lives in UNIVERSAL_PROPS,
//                      read via parseStyle(element.props.style)).
// App-only props NOT implemented (allowed subset): `disabled`. A config that
// sets `disabled` pastes in harmlessly (the extra prop is ignored).
//
// The host-state seam: the app uses a shadcn Slider + 300ms debounce; openfused
// does NOT reproduce that heavy UI — only the PROP CONTRACT and the param-write
// semantics must match. It DOES use `useFusedParamWithForm` (the form-aware
// variant): outside a form it two-way binds the named param exactly like
// `useFusedParam`; inside a `form` it becomes local state and mirrors its value
// into the form's field store for collective submit (see form.tsx).
// `broadcastDefaultValue` ("broadcast `defaultValue` on mount if no
// canvas value exists") is the old `initIfAbsent` seed, gated on an authored
// `defaultValue` so a slider without one reads the live value but never seeds
// `0` into the param unintentionally. When `param` is undefined the hook works
// as plain local state (per the SDK contract).
//
// `current` coerces the live value to a number (falling back to `min`), the
// dumb `SliderRange` ui-kit primitive drives the track fill from `value` and
// emits the new Number via `onValueChange`, and the row-style label shows the
// caption plus the live value.
//
// Wave-4 split (spec/ui/ui-architecture.md §6.2): the dumb control lives in
// `@kit` (`SliderRange` — value/onValueChange, no param store); THIS file is the
// thin param-binding wrapper that keeps the `defineComponent` declaration + the
// `@fusedio/widget-sdk` `useFusedParamWithForm` hook. `ofw-*` slider classes are
// replaced by the primitive + Tailwind utility classes.

import { z } from "zod";
import {
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { SliderRange } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// ----------------------------------------------------------------- props schema
// Subset of the application slider's contract — identical names/types/semantics:
//   param (optional), label (optional), min (default 0), max (default 100),
//   step (default 1), defaultValue (default 0), + the two universal props
//   (`style`). `style` lives ONLY in UNIVERSAL_PROPS.shape.
export const sliderProps = z
  .object({
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the slider."),
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with, or form field name if inside a Form component. If omitted, works as a regular slider.",
      ),
    min: z.number().optional().default(0).describe("Minimum value."),
    max: z.number().optional().default(100).describe("Maximum value."),
    step: z
      .number()
      .optional()
      .default(1)
      .describe("Increment between values."),
    defaultValue: z
      .number()
      .optional()
      .default(0)
      .describe("Initial value seeded into the param on mount."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type SliderProps = z.infer<typeof sliderProps>;

// -------------------------------------------------------------------- component
function Slider({ element }: ComponentRenderProps<SliderProps>) {
  const { param, label, min, max, step, defaultValue, style } = element.props;

  const lo = typeof min === "number" ? min : 0;
  const hi = typeof max === "number" ? max : 100;

  // `defaultValue` was only AUTHORED when the raw prop is present — zod's
  // `.default(0)` makes the parsed value 0 even when omitted, so gate the seed
  // on the raw prop to preserve the old `initIfAbsent` ("seed iff present")
  // semantics: a slider without an authored default reads the live value but
  // never broadcasts 0 into the param.
  const authoredDefault =
    (element.props as Record<string, unknown>).defaultValue !== undefined;
  const seed = typeof defaultValue === "number" ? defaultValue : lo;

  // The SDK hook two-way binds to the named param (or behaves as plain local
  // state when `param` is undefined/empty). `broadcastDefaultValue` seeds
  // `defaultValue` on mount iff the param is absent AND a default was authored.
  const { value, setValue } = useFusedParamWithForm<number>({
    param,
    defaultValue: seed,
    broadcastDefaultValue: authoredDefault,
  });

  const id = `ofw-slider-${param ?? "local"}`;

  const current =
    typeof value === "number"
      ? value
      : value !== undefined && value !== null && (value as unknown) !== ""
        ? Number(value)
        : lo;
  const stepSize = typeof step === "number" ? step : 1;

  return (
    <Field label={undefined} htmlFor={id} style={parseStyle(style)}>
      {label ? (
        <label
          className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          htmlFor={id}
        >
          <span>{label}</span>
          <span className="rounded-md bg-primary/10 px-2 py-px font-mono text-xs tabular-nums normal-case tracking-normal text-primary">
            {current}
          </span>
        </label>
      ) : null}
      <SliderRange
        id={id}
        min={lo}
        max={hi}
        step={stepSize}
        value={current}
        onValueChange={(n) => setValue(n)}
      />
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Slider,
    props: sliderProps,
    description:
      "A slider that can optionally sync with canvas parameters. If param is provided, syncs with that parameter or form; otherwise works as a regular slider.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
