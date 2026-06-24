// widgets/gallery-input.tsx — a grid of preset image thumbnails; clicking one
// writes its `value` to a `param` and highlights it.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm({ param, defaultValue })`, styles
// via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag.
//
// Prop contract is a strict SUBSET of the application's gallery-input
// (application/client/src/udfrun/json-ui/components/gallery-input.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props — param (optional), label, options,
// defaultValue. The universal `css` is read off `element.props.style`.
//
// IMPORTANT app-parity note — this is a CONFIG-compat / behaviour SUBSET. The
// application sources options from a DuckDB `sql` query (with options as the
// fallback) and supports horizontal/vertical/grid/carousel layouts, nullable,
// cardHeight/cardWidth, and object-valued options. openfused imports ONLY the
// SDK + local primitives, so it keeps the static `options` path only and renders
// a single wrapping flex grid. The option shape mirrors the app's
// {value, title, image} but uses {value, src, label} per the batch spec; values
// are strings only. App-only props (sql, mode, nullable, cardHeight, cardWidth,
// disabled) are intentionally omitted; a pasted app config that sets them is
// ignored here. Selection highlight + grid use inline styles (no new ofw- CSS).

import React from "react";
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
// A strict subset of the application's GalleryInputPropsSchema: identical
// names/types/semantics (string-valued options only), plus the universal `style`
// prop folded in via `.extend(UNIVERSAL_PROPS.shape)`.
export const galleryInputOptionProps = z.object({
  value: z
    .string()
    .describe("The value broadcast to the param when this option is selected."),
  src: z.string().describe("Image URL or base64 data URL shown in the card."),
  label: z
    .string()
    .optional()
    .describe("Title displayed under the image; defaults to value."),
});

export const galleryInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with, or form field name if inside a Form component.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the gallery."),
    options: z
      .array(galleryInputOptionProps)
      .optional()
      .describe(
        "Static array of options. Each option is a {value, src, label?}; options with an empty value are skipped.",
      ),
    defaultValue: z
      .string()
      .optional()
      .describe(
        "Initial value when no canvas/form value exists. Should match one option's value.",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type GalleryInputProps = z.infer<typeof galleryInputProps>;

interface ResolvedOption {
  value: string;
  src: string;
  label: string;
}

// Drop options with empty value/src; label defaults to the (trimmed) value.
function sanitizeOptions(
  opts: Array<{ value: string; src: string; label?: string }> | undefined,
): ResolvedOption[] {
  if (!opts || !Array.isArray(opts)) return [];
  const result: ResolvedOption[] = [];
  for (const o of opts) {
    if (o?.value == null) continue;
    const value = String(o.value).trim();
    const src = o.src != null ? String(o.src).trim() : "";
    if (value === "" || src === "") continue;
    const label = o.label != null ? String(o.label).trim() : "";
    result.push({ value, src, label: label || value });
  }
  return result;
}

// -------------------------------------------------------------------- component
function GalleryInput({ element }: ComponentRenderProps<GalleryInputProps>) {
  const { param, label, options, defaultValue } = element.props;
  const style = (element.props as { style?: string }).style;

  const resolved = React.useMemo(() => sanitizeOptions(options), [options]);

  // Seed `defaultValue` on mount iff it is a non-empty string matching an
  // option; empty defaults are guarded by the SDK and never broadcast.
  const hasDefault =
    typeof defaultValue === "string" && defaultValue.trim() !== "";

  // Form-ready param binding: identical API to useFusedParam, defers broadcast
  // inside a Form, behaves as useFusedParam outside one. debounceMs 0 — a click
  // is a deliberate single action.
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: hasDefault ? (defaultValue as string) : "",
    broadcastDefaultValue: hasDefault,
    debounceMs: 0,
  });

  const id = `ofw-gallery-${param ?? "local"}`;
  const selected = value ?? "";

  const handleSelect = React.useCallback(
    (optionValue: string) => {
      setValue(optionValue);
    },
    [setValue],
  );

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      {resolved.length === 0 ? (
        <div style={{ fontSize: 13, color: "#888" }}>No options available</div>
      ) : (
        <div
          id={id}
          role="radiogroup"
          aria-label={label}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {resolved.map((option) => {
            const isSelected = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelect(option.value)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  width: 140,
                  padding: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  background: "transparent",
                  borderRadius: 10,
                  border: isSelected
                    ? "2px solid var(--ofw-accent, #b5f23d)"
                    : "2px solid transparent",
                  boxShadow: isSelected
                    ? "0 0 0 1px var(--ofw-accent, #b5f23d)"
                    : "none",
                }}
              >
                <img
                  src={option.src}
                  alt={option.label}
                  style={{
                    width: "100%",
                    height: 96,
                    objectFit: "cover",
                    borderRadius: 8,
                    display: "block",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: GalleryInput,
    props: galleryInputProps,
    description:
      "Image-thumbnail gallery input; clicking a preset option writes its value to a param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
