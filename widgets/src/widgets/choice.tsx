// widgets/choice.tsx — a single- or multi-select question with an optional
// "Other" escape hatch that reveals a free-text field when chosen.
//
// An openfused/agent_core-owned FEEDBACK input (no Fused application parity, a
// sibling of `checkbox-group`). Built for the architect's up-front grilling
// pass: it scopes the whole task, then asks ALL its clarifying questions in ONE
// `ask_user` widget — each question is a `choice`. `mode: "single"` renders
// radios (one answer), `mode: "multiple"` renders checkboxes (any number). When
// `allowOther` is set, an "Other" choice is appended; selecting it reveals a
// text input and the human's typed answer becomes the param value — so a
// question is never a dead end when none of the proposed options fit.
//
// Param semantics:
//   • single   → writes the chosen option's `value` (a scalar string), or the
//                typed text when "Other" is selected. Binds via
//                `useFusedParamWithForm` so it participates in a wrapping `form`.
//   • multiple → writes an ARRAY of the chosen option values, with the typed
//                "Other" text appended when present. Binds via `useFusedParam`
//                (the array twin, exactly like `checkbox-group`). An array param
//                is feedback for the agent — NEVER reference it in SQL.
//
// Options are STATIC ({value, label?}[]) — the agent proposes the concrete
// choices, so there is no sql-sourced variant (that is what `dropdown` /
// `checkbox-group` are for). Authored against `@fusedio/widget-sdk` + the shared
// `@kit` ui-kit primitives (`RadioCardGroup`, `Checkbox`, `Label`, `Input`).

import React from "react";
import { z } from "zod";
import {
  useFusedParam,
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { RadioCardGroup, Checkbox, Label, Input } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import { sanitizeStaticOptions } from "./_options";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// Sentinel key for the synthetic "Other" choice. A real option value is
// extremely unlikely to collide with this; the guard below excludes it from the
// resolved option set just in case.
const OTHER_KEY = "__other__";

// ----------------------------------------------------------------- props schema
export const choiceProps = z
  .object({
    label: z
      .string()
      .optional()
      .describe("The question text, shown above the choices."),
    param: z
      .string()
      .optional()
      .describe(
        "Canvas parameter to sync with. In single mode it receives the chosen value as a scalar string (or the typed 'Other' text); in multiple mode it receives an ARRAY of chosen values. If omitted, the choice is non-broadcasting.",
      ),
    mode: z
      .enum(["single", "multiple"])
      .optional()
      .default("single")
      .describe(
        "single = radios (exactly one answer); multiple = checkboxes (any number). Defaults to single.",
      ),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string().optional(),
        }),
      )
      .optional()
      .default([])
      .describe(
        "The proposed choices as {value, label?} (label defaults to value). These are static — the agent proposes them.",
      ),
    defaultValue: z
      .string()
      .optional()
      .describe(
        "single mode only: option value pre-selected on mount (seeded iff the param has no value yet).",
      ),
    defaultSelected: z
      .array(z.string())
      .optional()
      .describe(
        "multiple mode only: option values pre-ticked on mount (seeded iff the param has no value yet).",
      ),
    allowOther: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Append an 'Other' choice; selecting it reveals a free-text field whose text becomes the answer. Set this on almost every question so the human can always answer off-menu.",
      ),
    otherLabel: z
      .string()
      .optional()
      .default("Other")
      .describe("Label for the 'Other' choice."),
    otherPlaceholder: z
      .string()
      .optional()
      .default("Type your answer…")
      .describe("Placeholder for the revealed free-text field."),
    disabled: z
      .boolean()
      .optional()
      .describe(
        "Render the question read-only — the frozen answered-card view sets this so a resolved answer can be seen but not changed.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type ChoiceProps = z.infer<typeof choiceProps>;

// -------------------------------------------------------- single-select variant
function SingleChoice({
  label,
  param,
  options,
  defaultValue,
  allowOther,
  otherLabel,
  otherPlaceholder,
  fieldStyle,
  id,
  disabled,
}: {
  label?: string;
  param?: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  allowOther: boolean;
  otherLabel: string;
  otherPlaceholder: string;
  fieldStyle: React.CSSProperties;
  id: string;
  disabled?: boolean;
}) {
  const { value, setValue } = useFusedParamWithForm({
    param,
    // Widen to `string` so `setValue` accepts any string (the literal ""
    // would otherwise pin the generic to the "" literal type).
    defaultValue: "" as string,
    broadcastDefaultValue: false,
  });

  const optionValues = React.useMemo(
    () => new Set(options.map((o) => o.value)),
    [options],
  );

  // Derive the initial UI state from the current param value (so the widget
  // round-trips an existing answer), else from defaultValue.
  const seed = (value ?? "") === "" ? (defaultValue ?? "") : String(value);
  const seededIsOption = seed !== "" && optionValues.has(seed);
  const [selKey, setSelKey] = React.useState<string>(() => {
    if (seededIsOption) return seed;
    if (seed !== "" && allowOther) return OTHER_KEY;
    return "";
  });
  const [otherText, setOtherText] = React.useState<string>(() =>
    !seededIsOption && seed !== "" ? seed : "",
  );

  // One-shot seed of the param from defaultValue when nothing exists yet. Seed
  // whether defaultValue matches a listed option OR is an off-menu "Other" seed
  // (allowOther) — the initial UI state (selKey/otherText above) reflects both,
  // so the param MUST too, else the Other field renders pre-filled while the
  // param/form store stays empty (silent submit-time data loss inside a form).
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if ((value ?? "") !== "") return; // param already has a value
    if (defaultValue && (optionValues.has(defaultValue) || allowOther)) {
      setValue(defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const radioOptions = React.useMemo(
    () => [
      ...options.map((o) => ({ value: o.value, title: o.label })),
      ...(allowOther ? [{ value: OTHER_KEY, title: otherLabel }] : []),
    ],
    [options, allowOther, otherLabel],
  );

  const onPick = (picked: string) => {
    setSelKey(picked);
    if (picked === OTHER_KEY) {
      // Broadcast the current other text (may be empty until typed).
      setValue(otherText);
    } else {
      setValue(picked);
    }
  };

  const onOtherText = (text: string) => {
    setOtherText(text);
    if (selKey === OTHER_KEY) setValue(text);
  };

  return (
    <Field label={label} htmlFor={id} style={fieldStyle}>
      <RadioCardGroup
        ariaLabel={label ?? "Choose one"}
        value={selKey}
        onValueChange={onPick}
        options={radioOptions}
        disabled={disabled}
      />
      {allowOther && selKey === OTHER_KEY ? (
        <Input
          className="mt-2"
          value={otherText}
          placeholder={otherPlaceholder}
          onChange={(e) => onOtherText(e.target.value)}
          aria-label={`${otherLabel}: your answer`}
          disabled={disabled}
        />
      ) : null}
    </Field>
  );
}

// ------------------------------------------------------ multiple-select variant
function MultiChoice({
  label,
  param,
  options,
  defaultSelected,
  allowOther,
  otherLabel,
  otherPlaceholder,
  fieldStyle,
  id,
  disabled,
}: {
  label?: string;
  param?: string;
  options: { value: string; label: string }[];
  defaultSelected?: string[];
  allowOther: boolean;
  otherLabel: string;
  otherPlaceholder: string;
  fieldStyle: React.CSSProperties;
  id: string;
  disabled?: boolean;
}) {
  // ARRAY param binding — the checkbox-group / sql-table selection pattern.
  const { value, setValue } = useFusedParam<string[]>({
    param,
    defaultValue: [],
    broadcastDefaultValue: false,
  });

  const optionValues = React.useMemo(
    () => new Set(options.map((o) => o.value)),
    [options],
  );

  // Split the current param array into ticked known options + a single leftover
  // "other" text (any value that is not a known option).
  const paramArray = React.useMemo<string[]>(
    () => (Array.isArray(value) ? value.map((v) => String(v)) : []),
    [value],
  );
  const initialTicked = React.useMemo(
    () => paramArray.filter((v) => optionValues.has(v)),
    [paramArray, optionValues],
  );
  const initialOther = React.useMemo(
    () => paramArray.find((v) => !optionValues.has(v)) ?? "",
    [paramArray, optionValues],
  );

  const [ticked, setTicked] = React.useState<string[]>(() =>
    initialTicked.length > 0 ? initialTicked : (defaultSelected ?? []).filter((v) => optionValues.has(v)),
  );
  const [otherOn, setOtherOn] = React.useState<boolean>(() => initialOther !== "");
  const [otherText, setOtherText] = React.useState<string>(() => initialOther);

  const broadcast = (nextTicked: string[], nextOtherOn: boolean, nextOtherText: string) => {
    const out = [...nextTicked];
    if (nextOtherOn && nextOtherText.trim() !== "") out.push(nextOtherText);
    setValue(out);
  };

  // One-shot seed from defaultSelected when the param is still empty.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (paramArray.length > 0) return;
    const seedTicked = (defaultSelected ?? []).filter((v) => optionValues.has(v));
    if (seedTicked.length > 0) {
      setTicked(seedTicked);
      broadcast(seedTicked, false, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (optionValue: string) => {
    const next = ticked.includes(optionValue)
      ? ticked.filter((v) => v !== optionValue)
      : [...ticked, optionValue];
    setTicked(next);
    broadcast(next, otherOn, otherText);
  };

  const toggleOther = () => {
    const next = !otherOn;
    setOtherOn(next);
    broadcast(ticked, next, otherText);
  };

  const onOtherText = (text: string) => {
    setOtherText(text);
    if (otherOn) broadcast(ticked, true, text);
  };

  return (
    <Field label={label} htmlFor={id} style={fieldStyle}>
      <div id={id} role="group" aria-label={label} className="flex flex-col gap-2">
        {options.map((o) => {
          const rowId = `${id}-opt-${o.value}`;
          return (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={rowId}
                checked={ticked.includes(o.value)}
                onCheckedChange={() => toggle(o.value)}
                disabled={disabled}
              />
              <Label htmlFor={rowId} className="cursor-pointer font-normal">
                {o.label}
              </Label>
            </div>
          );
        })}
        {allowOther ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-other`}
              checked={otherOn}
              onCheckedChange={toggleOther}
              disabled={disabled}
            />
            <Label htmlFor={`${id}-other`} className="cursor-pointer font-normal">
              {otherLabel}
            </Label>
          </div>
        ) : null}
      </div>
      {allowOther && otherOn ? (
        <Input
          className="mt-2"
          value={otherText}
          placeholder={otherPlaceholder}
          onChange={(e) => onOtherText(e.target.value)}
          aria-label={`${otherLabel}: your answer`}
          disabled={disabled}
        />
      ) : null}
    </Field>
  );
}

// -------------------------------------------------------------------- component
function Choice({ element }: ComponentRenderProps<ChoiceProps>) {
  const {
    label,
    param,
    mode = "single",
    options,
    defaultValue,
    defaultSelected,
    allowOther = false,
    otherLabel = "Other",
    otherPlaceholder = "Type your answer…",
    disabled = false,
  } = element.props;
  const style = (element.props as { style?: string }).style;
  const fieldStyle = parseStyle(style);
  const id = `ofw-choice-${param ?? "field"}`;

  // Static options only (agent proposes the choices); drop the OTHER sentinel if
  // an author ever collides with it.
  const resolved = sanitizeStaticOptions(options).filter((o) => o.value !== OTHER_KEY);

  return mode === "multiple" ? (
    <MultiChoice
      label={label}
      param={param}
      options={resolved}
      defaultSelected={defaultSelected}
      allowOther={allowOther}
      otherLabel={otherLabel}
      otherPlaceholder={otherPlaceholder}
      fieldStyle={fieldStyle}
      id={id}
      disabled={disabled}
    />
  ) : (
    <SingleChoice
      label={label}
      param={param}
      options={resolved}
      defaultValue={defaultValue}
      allowOther={allowOther}
      otherLabel={otherLabel}
      otherPlaceholder={otherPlaceholder}
      fieldStyle={fieldStyle}
      id={id}
      disabled={disabled}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Choice,
    props: choiceProps,
    description:
      "Single- or multi-select question with an optional 'Other' escape hatch. mode:'single' renders radios and writes the chosen value (scalar); mode:'multiple' renders checkboxes and writes an ARRAY. When allowOther is set, an 'Other' choice reveals a free-text field whose text becomes the answer — so the human is never boxed in. Options are static {value,label?}. Ideal for an agent asking a batch of clarifying questions in one ask_user widget. The multiple-mode array param is feedback — never reference it in SQL.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
