// widgets/video.tsx — a plain <video> from a URL or data URL.
//
// Authored ONLY against `@fusedio/widget-sdk`, mirroring the canonical display
// media widget (image.tsx): reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, styles via `parseStyle(element.props.style)`,
// and default-exports `defineComponent({...})` + the `writesParam` flag.
//
// `video` is a display component — not data-bound, writes no param. Prop contract
// is a strict SUBSET of the application's video
// (application/client/src/udfrun/json-ui/components/video.tsx): identical prop
// NAMES/TYPES/SEMANTICS — `src` (required), `poster`, `controls`, `autoPlay`,
// `loop`, `muted`, `objectFit` — plus the universal props (`style`). The app
// resolves `src` through `useMediaSrc` (signable storage paths, loading/error
// states, signed-URL refresh on network error); openfused deliberately keeps the
// lightweight plain `<video src={src}>` path and imports ONLY the SDK + local
// primitives — so signable-path src values are passed verbatim to <video>. This
// is a CONFIG-compat mapping, not a render-fidelity mapping.
//
// The host-state seam barely changes: the default inline style mirrors the app's
// absolutely-positioned cover layout, and `parseStyle(element.props.style)` is
// spread OVER the container (user declarations win last). The proven behavior is
// preserved: a missing `src` renders a visible placeholder, never a broken video.

import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's VideoPropsSchema: identical
// names/types/semantics — src (required), poster, controls, autoPlay, loop,
// muted, objectFit — plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`. The universal inline style is read off
// `element.props.style`; it is NOT redeclared here. App-only `alt`/`playsInline`
// are intentionally omitted from this subset.
export const videoProps = z
  .object({
    src: z
      .string()
      .describe(
        'Video URL or base64 data URL (e.g., "https://…/clip.mp4" or "data:video/mp4;base64,…").',
      ),
    poster: z
      .string()
      .optional()
      .describe("Poster image URL shown before playback starts."),
    controls: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to show native playback controls."),
    autoPlay: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether the video starts playing automatically."),
    loop: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether the video loops after ending."),
    muted: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether the video is muted (required for autoplay in most browsers).",
      ),
    objectFit: z
      .enum(["contain", "cover", "fill", "none", "scale-down"])
      .optional()
      .default("contain")
      .describe("How the video fits its container."),
  })
  .extend(UNIVERSAL_PROPS.shape);

type VideoProps = z.infer<typeof videoProps>;

// -------------------------------------------------------------------- component
function Video({ element }: ComponentRenderProps<VideoProps>) {
  const { src, poster, controls, autoPlay, loop, muted, objectFit } =
    element.props;
  // The universal inline-style key (the `css -> style` rename lands in
  // ./_universal.ts globally; this file reads `style` per the rule).
  const style = (element.props as { style?: string }).style;

  // Missing src renders a visible placeholder, never a broken video.
  if (!src) {
    return (
      <div className="ofw-unknown" role="alert">
        video: missing src
      </div>
    );
  }

  return (
    <div
      className="ofw-video"
      style={{
        position: "relative",
        width: "100%",
        overflow: "hidden",
        ...parseStyle(style),
      }}
    >
      <video
        src={src}
        poster={poster}
        controls={controls ?? true}
        autoPlay={autoPlay ?? false}
        loop={loop ?? false}
        muted={muted ?? false}
        playsInline
        style={{
          display: "block",
          width: "100%",
          maxWidth: "100%",
          objectFit: objectFit ?? "contain",
        }}
      />
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Video,
    props: videoProps,
    description: "Display a video from a URL or base64 data URL.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
