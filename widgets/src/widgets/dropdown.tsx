// widgets/dropdown.tsx — dropdown that writes its selected value to a `param`.
// Options come from a static `options` array of {value, label?} or a dynamic
// `sql` query whose rows carry NAMED `value`/`label` columns (case-insensitive).
//
// This is the openfused `select` renamed and re-aligned to the Fused application
// `dropdown` component (client/src/udfrun/json-ui/components/dropdown.tsx) so an
// openfused-authored config pastes straight into the app. The prop contract here
// is a strict SUBSET of the app's: identical names/types/semantics, fewer props.
//
// Authored against `@fusedio/widget-sdk` for the contract/param binding and the
// shared `@kit` ui-kit `Select` primitive for the rendered control (spec/ui-
// architecture.md §6.2: dumb control + thin param-binding wrapper). Reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`, binds
// the param via `useFusedParamWithForm({ param, defaultValue, broadcastDefaultValue })`,
// sources dynamic options via `useDuckDbSqlQuery({ sql, queryId })`, styles the
// Field shell via `parseStyle(props.style)`, and default-exports
// `defineComponent({...})` + the `writesParam: true` flag. The leaf rendering
// delegates to ui-kit's Radix `Select` (Tailwind/CVA) instead of bespoke ofw-*
// markup; behaviour (param binding, defaults, placeholder, disabled) is unchanged.
//
// Alignment changes vs the old openfused `select`:
//   • optionsQuery → sql   (key rename only; SQL string/dialect untouched).
//   • default      → defaultValue (universal input rename; narrowed to string).
//   • param        is now OPTIONAL (app declares it optional).
//   • options      keeps only the {value, label?} object form (no bare scalars).
//   • SQL columns are read by NAME (value/label, case-insensitive) per the app's
//     normalizeSqlRow, not positionally; rows with empty/null value are dropped.
//   • on SQL error / empty rows, fall back to static `options` (app precedence)
//     instead of rendering a hard ErrorState.
//   • ADD placeholder / disabled / nullable (all honorable with a native <select>).
//
// Behaviour preserved from select: the self-reference guard (sql must not
// reference its own `param`, detected via `extractSqlParams`) and the
// synthetic-default option (a `defaultValue` absent from the resolved list is
// prepended so the store and widget never disagree).

import React from "react";
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  extractSqlParams,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import {
  sanitizeStaticOptions,
  normalizeSqlRow,
  type ResolvedOption,
} from "./_options";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";
import { LoadingState } from "../components/card";

// ----------------------------------------------------------------- props schema
// Mirrors src/openfused/widgets/schema/dropdown.json's prop set exactly, and is a
// strict subset of the application DropdownPropsSchema:
//   label, param (optional), sql, options ({value,label?}), placeholder,
//   defaultValue, disabled, nullable, + the universal `style` prop.
export const dropdownProps = z
  .object({
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the dropdown."),
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with, or form field name if inside a Form component. If omitted, works as a regular dropdown.",
      ),
    sql: z
      .string()
      .optional()
      .describe(
        "DuckDB SQL query that returns rows with NAMED 'value' and 'label' columns. Takes precedence over options. Must not reference its own param.",
      ),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string().optional(),
        }),
      )
      .optional()
      .describe(
        "Static option list used when sql is absent or fails. Each entry is a {value, label?}; label defaults to value.",
      ),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text shown when nothing is selected."),
    defaultValue: z
      .string()
      .optional()
      .describe(
        "Initial value when no canvas/form value exists; prepended as a synthetic option if absent from the loaded list.",
      ),
    disabled: z
      .boolean()
      .optional()
      .describe("Whether the dropdown control is disabled."),
    nullable: z
      .boolean()
      .optional()
      .describe(
        "If true, no option is auto-selected when defaultValue is absent; the param starts cleared/null. If false, the first option is auto-selected.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type DropdownProps = z.infer<typeof dropdownProps>;

// The option model + normalization (sanitizeStaticOptions / normalizeSqlRow)
// are shared with `checkbox-group` and live in ./_options.ts — the contract is
// intentionally identical across the two selection inputs.

// -------------------------------------------------------------------- component
function Dropdown({ element }: ComponentRenderProps<DropdownProps>) {
  const {
    label,
    param,
    sql,
    options,
    placeholder,
    defaultValue,
    disabled,
    nullable,
  } = element.props;
  // `style` is the universal inline-style prop folded in via UNIVERSAL_PROPS in
  // _universal.ts (the css→style universal rename lives there, owned at that
  // file). Read it off props the same way `_queryId` is — without redeclaring
  // style on this component.
  const style = (element.props as { style?: string }).style;
  const queryId = (element.props as { _queryId?: string })._queryId;
  const id = `ofw-dropdown-${param ?? "field"}`;
  const fieldStyle = parseStyle(style);

  const hasSql = !!sql && sql.trim().length > 0;

  // Self-reference detection: sql must not depend on its own param. This is a
  // render-time defensive guard with no app prop equivalent — a valid app config
  // never legitimately references the param it writes, so keeping it cannot make
  // a pasted app config fail.
  const selfReference =
    hasSql && !!param && extractSqlParams(sql as string).includes(param);

  // Drive the SQL query only when there's sql and no self-reference.
  const queryEnabled = hasSql && !selfReference;
  const {
    rows,
    loading: sqlLoading,
    error: sqlError,
  } = useDuckDbSqlQuery({
    sql: queryEnabled ? sql : undefined,
    queryId,
    enabled: queryEnabled,
  });

  // Static options (used directly, or as the sql fallback).
  const staticOptions = sanitizeStaticOptions(options);

  // SQL-sourced options, read by NAMED value/label columns.
  let sqlOptions: ResolvedOption[] = [];
  if (queryEnabled && !sqlLoading && !sqlError) {
    sqlOptions = rows
      .map((row) => normalizeSqlRow(row as Record<string, unknown>))
      .filter((o): o is ResolvedOption => o !== null);
  }

  // App precedence: prefer sql when it yields rows; fall back to static options
  // on sql error OR empty rows. When there's no sql, just use static options.
  let resolved: ResolvedOption[];
  if (queryEnabled) {
    resolved = sqlOptions.length > 0 ? sqlOptions : staticOptions;
  } else {
    resolved = staticOptions;
  }

  // While the sql query is loading we don't yet know the option set; treat the
  // control as disabled (the app shows a "Loading..." placeholder + disabled).
  const isLoading = queryEnabled && sqlLoading;

  // synthetic-default: a non-empty `defaultValue` absent from the resolved list
  // is prepended so the store and widget never disagree.
  if (
    typeof defaultValue === "string" &&
    defaultValue !== "" &&
    !isLoading &&
    resolved.length > 0 &&
    !resolved.some((o) => o.value === defaultValue)
  ) {
    resolved = [{ value: defaultValue, label: defaultValue }, ...resolved];
  }

  // Two-way bind to the param. `broadcastDefaultValue` IS the old
  // `store.initIfAbsent(param, dflt)` — seed `defaultValue` on mount iff the
  // param is absent. Empty-string defaults are guarded internally by the SDK and
  // never broadcast, so gate the flag on a non-empty default.
  // useFusedParamWithForm<T> constrains T to string | number, so the cleared
  // state is the empty string "" (not null). For a native <select> whose option
  // values are always strings this is equivalent — "" is the no-selection
  // sentinel everywhere below — and outside a form it binds the param exactly
  // like the previous useFusedParam<string | null>. Inside a `form` it mirrors
  // its value into the form field store for collective submit (see form.tsx).
  const hasDefault = typeof defaultValue === "string" && defaultValue !== "";
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: hasDefault ? defaultValue : "",
    broadcastDefaultValue: hasDefault,
  });

  // nullable controls first-option auto-selection when no defaultValue exists:
  // !nullable seeds the first resolved option; nullable leaves the param cleared.
  React.useEffect(() => {
    if (hasDefault) return;
    if (nullable) return;
    if (isLoading) return;
    if (value !== undefined && value !== "") return;
    if (resolved.length === 0) return;
    setValue(resolved[0].value);
    // resolved is recomputed each render; key the effect on the first value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDefault, nullable, isLoading, resolved[0]?.value, value, setValue]);

  // Current selected value, as a string for the <select> element ("" = none).
  const current = value ? String(value) : "";

  const effectiveDisabled = !!disabled || isLoading;

  // Placeholder text shown when nothing is selected. Radix renders it via
  // <SelectValue placeholder> (no empty-value <option> sentinel — Radix forbids
  // a SelectItem with value=""), so the disabled empty option from the old
  // native <select> becomes the placeholder string here.
  const placeholderText = isLoading
    ? "Loading…"
    : placeholder ?? "Select an option...";

  return (
    <Field label={label} htmlFor={id} style={fieldStyle}>
      {/* current === "" is the no-selection sentinel; pass undefined so Radix
          shows the placeholder rather than treating "" as a (forbidden) item. */}
      <Select
        value={current || undefined}
        disabled={effectiveDisabled}
        onValueChange={(v: string) => setValue(v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholderText} />
        </SelectTrigger>
        {/* `position="popper"` (floating-ui) is required so the options portal
            positions correctly when the dropdown is rendered inside a scroll /
            overflow container (e.g. the inbox question card's max-h overflow-auto
            box) — the default "item-aligned" mode fails to place the popup there,
            so it opens empty. */}
        <SelectContent position="popper" sideOffset={4}>
          {resolved.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLoading ? <LoadingState label="Loading options…" /> : null}
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Dropdown,
    props: dropdownProps,
    description:
      "Dropdown that writes the chosen option value to a param; options may be static ({value, label}) or sourced from a DuckDB SQL query returning value/label columns.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
