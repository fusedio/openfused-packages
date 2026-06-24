// widgets/checkbox-group.tsx — multi-select checkbox set that writes the chosen
// option values to a param as an ARRAY (spec/widgets/checkbox-group.md).
//
// The array twin of `dropdown`: the human ticks zero or more of N choices and
// the chosen `value`s are broadcast to the param store as an ARRAY — the reply
// channel for the agent's "pick any of these" asks (a multi-select input in an
// agent-authored `ask_user` widget). It is the only json-ui input that writes a
// non-scalar value by design.
//
// App-parity: this is an OpenFused-owned FEEDBACK input with NO Fused
// application equivalent (the app's only selection input is single-select
// `dropdown`; its multi-select facet is `sql-table` row-selection). So its prop
// names/semantics align to OpenFused's own `dropdown` (the closest sibling),
// NOT to an app component. Because it writes an ARRAY param it is — like
// `sql-table`'s `selectionParam` and `video-review` — a feedback primitive
// whose array param MUST NEVER be referenced in SQL ($param is text
// substitution; only scalars are SQL-safe — spec/json-ui-data.md).
//
// Authored against `@fusedio/widget-sdk` for the contract/param binding and the
// shared `@kit` ui-kit `Checkbox` + `Label` primitives (the dumb checked/
// onChange controls; spec/ui/ui-architecture.md §6.2 dumb-control + thin-binding
// split). Option resolution (static `options` / `sql` precedence, the named
// value/label normalization, the self-reference guard, the static→sql fallback)
// is IDENTICAL to `dropdown` and reuses its shared helpers (./_options).
//
// Differences from `dropdown`:
//   • binds via `useFusedParam<string[]>` — NOT `useFusedParamWithForm`, whose
//     value is constrained to `string | number` and cannot hold an array. The
//     write pattern is `sql-table`'s `selectionParam` verbatim
//     (`defaultValue: []`, `broadcastDefaultValue: false`, `Array.isArray` read).
//     So `checkbox-group` is NOT form-bundle-aware in v1 (it writes its own
//     param directly, like sql-table's selection) — acceptable because the card
//     forms it replaces submit through a paired `button`, not a `form`.
//   • `defaultSelected` (array) seeds the param on mount iff no canvas value
//     exists — the array analogue of dropdown's `defaultValue` seeding. There is
//     NO first-option auto-select and NO `nullable`: a multi-select's natural
//     empty state is "none ticked", so nothing is auto-selected.
//   • OPTIONAL advisory `minSelected` / `maxSelected` bounds: rendered as helper
//     text, and when `maxSelected` is reached the unticked rows render disabled.
//     The server is the authority; the bound is a UX guard. `checkbox-group`
//     does NOT own a submit button — a paired `button action submit:true`
//     settles the session, and the host wires the min bound to that submit (per
//     spec/widgets/specs/card-forms-to-json-ui.md). The min bound is purely
//     advisory at the component (it cannot block a button it does not own).

import React from "react";
import { z } from "zod";
import {
  useDuckDbSqlQuery,
  useFusedParam,
  parseStyle,
  defineComponent,
  extractSqlParams,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Checkbox, Label } from "@kit";

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
// Option resolution props (label/param/sql/options) mirror `dropdown` exactly;
// `defaultSelected`/`minSelected`/`maxSelected` are the multi-select additions.
export const checkboxGroupProps = z
  .object({
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the checkbox group."),
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with; receives the selection as an ARRAY of the chosen option values. If omitted, works as a regular non-broadcasting checkbox group.",
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
    defaultSelected: z
      .array(z.string())
      .optional()
      .describe(
        "Option values ticked on mount; seeded into the param iff no canvas value exists (broadcast only when non-empty).",
      ),
    minSelected: z
      .number()
      .optional()
      .describe(
        "Advisory minimum selection count; rendered as helper text and wired to a paired submit button at the host (the server is the authority).",
      ),
    maxSelected: z
      .number()
      .optional()
      .describe(
        "Advisory maximum selection count; when reached, unticked rows render disabled.",
      ),
    disabled: z
      .boolean()
      .optional()
      .describe("Whether the whole checkbox group is disabled."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type CheckboxGroupProps = z.infer<typeof checkboxGroupProps>;

// ----------------------------------------------------------------- bounds text
// Helper text surfaced when minSelected > 0 or maxSelected is set (e.g.
// "Select 1–3"). Advisory only — the host enforces it against the submit button.
function boundsHelperText(
  min: number,
  max: number | null,
): string | null {
  const hasMin = min > 0;
  const hasMax = max != null;
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax) {
    return min === max ? `Select ${min}` : `Select ${min}–${max}`;
  }
  if (hasMin) return `Select at least ${min}`;
  return `Select up to ${max}`;
}

// -------------------------------------------------------------------- component
function CheckboxGroup({ element }: ComponentRenderProps<CheckboxGroupProps>) {
  const { label, param, sql, options, defaultSelected, minSelected, maxSelected, disabled } =
    element.props;
  // `style` is the universal inline-style prop folded in via UNIVERSAL_PROPS in
  // _universal.ts (the css→style universal rename lives there). Read it off
  // props the same way `_queryId` is — without redeclaring style here.
  const style = (element.props as { style?: string }).style;
  const queryId = (element.props as { _queryId?: string })._queryId;
  const id = `ofw-checkbox-group-${param ?? "field"}`;
  const fieldStyle = parseStyle(style);

  const hasSql = !!sql && sql.trim().length > 0;

  // Self-reference detection: sql must not depend on its own param (the same
  // render-time defensive guard `dropdown` carries — a valid config never
  // references the param it writes, so this cannot break a pasted config).
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
  // on sql error OR empty rows. With no sql, just use static options.
  const resolved: ResolvedOption[] = queryEnabled
    ? sqlOptions.length > 0
      ? sqlOptions
      : staticOptions
    : staticOptions;

  // While the sql query is loading we don't yet know the option set; disable the
  // rows and show a loading indicator below (mirrors `dropdown`).
  const isLoading = queryEnabled && sqlLoading;

  // ARRAY param binding — the `sql-table` selectionParam pattern verbatim:
  // `defaultValue: []`, `broadcastDefaultValue: false` so the param is untouched
  // until the first interaction (or the defaultSelected seed below). The cleared
  // state is the empty array `[]`. useFusedParam (NOT ...WithForm) keeps the
  // array value, which the `string | number` form constraint would reject.
  const { value, setValue } = useFusedParam<string[]>({
    param,
    defaultValue: [],
    broadcastDefaultValue: false,
  });
  const selected = React.useMemo<string[]>(
    () =>
      Array.isArray(value) ? value.map((v) => String(v)) : [],
    [value],
  );

  // defaultSelected seeding: broadcast the (sanitized) defaults on mount ONCE,
  // and only when no canvas value already exists. A useRef guard makes this
  // strictly mount-time — unlike dropdown's first-option auto-select, we must
  // NOT re-seed after the human deliberately un-ticks everything (the empty set
  // is a valid multi-select state). An empty/absent defaultSelected seeds
  // nothing and leaves the param at [].
  const defaultSelectedValues = React.useMemo<string[]>(
    () =>
      Array.isArray(defaultSelected)
        ? defaultSelected
            .filter((v) => v != null)
            .map((v) => String(v).trim())
            .filter((v) => v !== "")
        : [],
    [defaultSelected],
  );
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (defaultSelectedValues.length === 0) return;
    // Seed only when the param is still untouched (no canvas value): `selected`
    // captured here is the mount-time value.
    if (selected.length > 0) return;
    setValue(defaultSelectedValues);
    // Mount-only: the seed is a one-shot. Re-running on `selected`/value changes
    // would re-seed after a user clear, which is wrong for a multi-select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bounds. minSelected defaults to 0 (advisory only at the component); a set
  // maxSelected, once reached, disables the unticked rows so the human cannot
  // exceed it (the server stays the authority).
  const min = typeof minSelected === "number" ? minSelected : 0;
  const max = typeof maxSelected === "number" ? maxSelected : null;
  const atMax = max != null && selected.length >= max;
  const boundsText = boundsHelperText(min, max);

  // Whole group disabled when `disabled` is true OR while loading; an individual
  // row additionally disables when maxSelected is reached and it is not ticked.
  const groupDisabled = !!disabled || isLoading;

  const toggle = (optionValue: string) => {
    if (groupDisabled) return;
    if (selected.includes(optionValue)) {
      // un-tick: drop it, preserving the order of the rest.
      setValue(selected.filter((v) => v !== optionValue));
    } else {
      // tick: append (preserve-on-toggle selection order). Defensive guard
      // against exceeding maxSelected even though the row is rendered disabled.
      if (atMax) return;
      setValue([...selected, optionValue]);
    }
  };

  return (
    <Field label={label} htmlFor={id} style={fieldStyle}>
      <div id={id} role="group" aria-label={label} className="flex flex-col gap-2">
        {resolved.map((o) => {
          const checked = selected.includes(o.value);
          const rowDisabled = groupDisabled || (atMax && !checked);
          const rowId = `${id}-opt-${o.value}`;
          return (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={rowId}
                checked={checked}
                disabled={rowDisabled}
                onCheckedChange={() => toggle(o.value)}
              />
              {/* @kit Label is Radix-based, so clicking the text forwards to the
                  associated checkbox (radix label click-forwarding) — one toggle,
                  no double-fire, and the text/control are announced as a pair. */}
              <Label htmlFor={rowId} className="cursor-pointer font-normal">
                {o.label}
              </Label>
            </div>
          );
        })}
      </div>
      {boundsText ? (
        <p className="text-xs text-muted-foreground">{boundsText}</p>
      ) : null}
      {isLoading ? <LoadingState label="Loading options…" /> : null}
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: CheckboxGroup,
    props: checkboxGroupProps,
    description:
      "Multi-select checkbox set that writes the chosen option values to a param as an ARRAY; options may be static ({value, label}) or sourced from a DuckDB SQL query returning value/label columns. Optional min/max selection bounds. The array param is feedback for the agent — never reference it in SQL.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
