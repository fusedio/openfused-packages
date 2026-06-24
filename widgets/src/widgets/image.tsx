// widgets/image.tsx — a plain <img> from a URL, data-URL, or signable storage path.
//
// Authored ONLY against `@fusedio/widget-sdk`, mirroring the verified exemplars
// (stat.tsx / bar-chart.tsx): reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, styles via `parseStyle(element.props.style)`,
// and default-exports `defineComponent({...})` + the `writesParam` flag.
//
// `image` is a display component — not data-bound, writes no param. Prop contract
// is a strict SUBSET of the application's image
// (application/client/src/udfrun/json-ui/components/image.tsx): identical prop
// NAMES/TYPES/SEMANTICS — `src` (required), `alt`, `objectFit`, plus the universal
// props (`style`). The app resolves `src` through `useMediaSrc` (signable
// storage paths, loading/error states, baseui Spinner); openfused deliberately
// keeps the lightweight plain `<img src={src}>` path and imports ONLY the SDK +
// local primitives — so signable-path src values are passed verbatim to <img>.
// This is a CONFIG-compat mapping, not a render-fidelity mapping.
//
// The host-state seam barely changes: the default inline style starts from
// `{ maxWidth: "100%", objectFit }` and `parseStyle(element.props.style)` is
// spread OVER it (user declarations win last, exactly as the old mergeCss did).
// The proven behavior is preserved: a missing `src` renders a visible
// placeholder, never a broken image.

import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's ImagePropsSchema: identical
// names/types/semantics — src (required), alt, objectFit — plus the universal
// props (`style`) folded in via `.extend(UNIVERSAL_PROPS.shape)`. The
// universal inline style is read off `element.props.style`; it is NOT redeclared
// here.
export const imageProps = z
  .object({
    src: z
      .string()
      .describe(
        'Image URL, base64 data URL, or signable storage path (e.g., "s3://bucket/image.png").',
      ),
    alt: z
      .string()
      .optional()
      .describe("Accessible description of the image."),
    objectFit: z
      .enum(["contain", "cover", "fill", "none", "scale-down"])
      .optional()
      .default("contain")
      .describe("How the image fits its container."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type ImageProps = z.infer<typeof imageProps>;

// -------------------------------------------------------------------- component
function Image({ element }: ComponentRenderProps<ImageProps>) {
  const { src, alt, objectFit } = element.props;
  // The universal inline-style key (the `css -> style` rename lands in
  // ./_universal.ts globally; this file reads `style` per the rule). Cast because
  // the inferred ImageProps still carries the legacy `css` key until that rename.
  const style = (element.props as { style?: string }).style;

  // Missing src renders a visible placeholder, never a broken image.
  if (!src) {
    return (
      <div className="ofw-unknown" role="alert">
        image: missing src
      </div>
    );
  }

  return (
    <img
      className="ofw-image"
      src={src}
      alt={alt ?? ""}
      style={{
        maxWidth: "100%",
        objectFit: objectFit ?? "contain",
        ...parseStyle(style),
      }}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Image,
    props: imageProps,
    description:
      "Display an image from a URL, base64 data URL, or signable storage path.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
