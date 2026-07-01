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

  // Initial UI state from the current param (round-trip an existing answer), else
  // from defaultValue. An off-menu value selects "Other" when allowed, otherwise a
  // synthetic option (see radioOptions) so the control reflects the stored value
  // instead of appearing blank (parity with `dropdown`).
  const seed = (value ?? "") === "" ? (defaultValue ?? "") : String(value);
  const seededIsOption = seed !== "" && optionValues.has(seed);
  const [selKey, setSelKey] = React.useState<string>(() => {
    if (seededIsOption) return seed;
    if (seed !== "") return allowOther ? OTHER_KEY : seed; // off-menu → Other or synthetic
    return "";
  });
  const [otherText, setOtherText] = React.useState<string>(() =>
    !seededIsOption && seed !== "" && allowOther ? seed : "",
  );

  // Persist an initial defaultValue into the param once, then keep the local UI
  // reconciled with EXTERNAL param changes (canvas hydration / restore / sync) —
  // not just the mount value, which otherwise leaves the ticks/Other stale.
  // `syncedRef` holds the param value we last reflected, so our own writes (via
  // `commit`) never trigger a redundant reconcile.
  const syncedRef = React.useRef<string>(String(value ?? ""));
  const initRef = React.useRef(false);
  const commit = (v: string) => {
    syncedRef.current = v;
    setValue(v);
  };
  React.useEffect(() => {
    const cur = String(value ?? "");
    if (!initRef.current) {
      initRef.current = true;
      // One-shot seed of the param from defaultValue when nothing exists yet, so an
      // untouched pre-filled control is captured on submit. ANY non-empty
      // defaultValue is seeded — it always renders selected (a listed option, the
      // Other field, or a synthetic off-menu radio), so the param must match or a
      // control that looks answered would submit empty.
      if (cur === "" && defaultValue) {
        commit(defaultValue);
        return;
      }
      // No seed needed — fall through to the reconcile below. `syncedRef` holds the
      // first-render param value; if the param has since hydrated to a different
      // value (canvas restore between first paint and this effect), reconcile now
      // instead of silently marking it synced.
    }
    if (syncedRef.current === cur) return; // our own write / already reflected
    syncedRef.current = cur;
    if (cur === "") {
      setSelKey("");
      setOtherText("");
    } else if (optionValues.has(cur)) {
      setSelKey(cur);
      setOtherText("");
    } else if (allowOther) {
      setSelKey(OTHER_KEY);
      setOtherText(cur);
    } else {
      setSelKey(cur); // off-menu, no Other → synthetic option below
      setOtherText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, optionValues, allowOther, defaultValue]);

  // A selected off-menu value with no "Other" escape gets a synthetic radio so the
  // control stays aligned with the param (round-trip / read-only when options
  // change or allowOther is omitted).
  const offMenuKey =
    selKey && selKey !== OTHER_KEY && !optionValues.has(selKey) ? selKey : "";
  const radioOptions = React.useMemo(
    () => [
      ...options.map((o) => ({ value: o.value, title: o.label })),
      ...(offMenuKey ? [{ value: offMenuKey, title: offMenuKey }] : []),
      ...(allowOther ? [{ value: OTHER_KEY, title: otherLabel }] : []),
    ],
    [options, allowOther, otherLabel, offMenuKey],
  );

  const onPick = (picked: string) => {
    setSelKey(picked);
    // "Other" broadcasts the current text (may be empty until typed); a real or
    // synthetic option broadcasts its value.
    commit(picked === OTHER_KEY ? otherText : picked);
  };

  const onOtherText = (text: string) => {
    setOtherText(text);
    if (selKey === OTHER_KEY) commit(text);
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

  const paramArray = React.useMemo<string[]>(
    () => (Array.isArray(value) ? value.map((v) => String(v)) : []),
    [value],
  );
  // DERIVE from the param every render (mirrors `checkbox-group`) so an external
  // fill/update after the first paint (canvas hydration, restore, sync) is
  // reflected — mount-only local state would go stale.
  const ticked = React.useMemo(
    () => paramArray.filter((v) => optionValues.has(v)),
    [paramArray, optionValues],
  );
  // Off-menu strings in the param — surfaced only when Other is enabled. The FIRST
  // is bound to the free-text field; any EXTRAS are preserved across checkbox
  // toggles / edits rather than silently dropped (they only clear when the human
  // explicitly turns Other off).
  const customs = React.useMemo(
    () => (allowOther ? paramArray.filter((v) => !optionValues.has(v)) : []),
    [allowOther, paramArray, optionValues],
  );
  const otherText = customs[0] ?? "";
  const extras = React.useMemo(() => customs.slice(1), [customs]);

  // The only local state: whether Other is toggled on while its text is empty
  // (the param can't encode that). An externally-present custom also shows it.
  const [otherOnState, setOtherOnState] = React.useState<boolean>(() => customs.length > 0);
  const otherOn = otherOnState || customs.length > 0;

  const commit = (
    nextTicked: string[],
    includeOther: boolean,
    text: string,
    keepExtras: boolean,
  ) => {
    const out = [...nextTicked];
    if (allowOther && includeOther && text.trim() !== "") out.push(text);
    if (keepExtras) out.push(...extras);
    setValue(Array.from(new Set(out))); // de-dupe, preserve order
  };

  // One-shot seed from defaultSelected when the param is still empty — including
  // OFF-MENU entries as customs when allowOther (parity with single mode, which
  // seeds an off-menu defaultValue).
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (paramArray.length > 0) return;
    const seedTicked = (defaultSelected ?? []).filter((v) => optionValues.has(v));
    const seedCustoms = allowOther
      ? (defaultSelected ?? []).filter((v) => !optionValues.has(v))
      : [];
    if (seedTicked.length > 0 || seedCustoms.length > 0) {
      if (seedCustoms.length > 0) setOtherOnState(true);
      setValue(Array.from(new Set([...seedTicked, ...seedCustoms])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (optionValue: string) => {
    const next = ticked.includes(optionValue)
      ? ticked.filter((v) => v !== optionValue)
      : [...ticked, optionValue];
    commit(next, otherOn, otherText, true);
  };

  const toggleOther = () => {
    const next = !otherOn;
    setOtherOnState(next);
    // Turning Other ON keeps any extras; turning it OFF is a deliberate "no other
    // answer" → drop every off-menu custom.
    if (next) commit(ticked, true, otherText, true);
    else commit(ticked, false, "", false);
  };

  const onOtherText = (text: string) => {
    setOtherOnState(true);
    commit(ticked, true, text, true);
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
