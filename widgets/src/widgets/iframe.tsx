// widgets/iframe.tsx — embed a web page or HTML-returning UDF in an iframe.
//
// A fan-out display component mirroring the stat/text exemplars. Authored ONLY
// against `@fusedio/widget-sdk`: reads `element.props`, declares real-zod props
// `.extend(UNIVERSAL_PROPS.shape)`, styles via `parseStyle(element.props.style)`,
// and default-exports `defineComponent({...})` plus the `writesParam` flag.
//
// Prop contract is a strict SUBSET of the application's iframe component
// (application/client/src/udfrun/json-ui/components/iframe.tsx): identical prop
// NAMES/TYPES/SEMANTICS, fewer props. The declared props are:
//   • `src`   (string, REQUIRED) — absolute http(s) URL, optionally carrying
//     $param URL templates, or an exact UDF placeholder like {{udf}} /
//     {{udf?name=$param}}. This is the iframe source.
//   • `title` (string, optional) — accessible title → iframe `title` attribute.
//   • `allow` (string, optional) — Permissions-Policy features → iframe `allow`.
// plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`; the universal `css -> style` rename lands in
// ./_universal.ts globally, so `style` is read off `element.props.style` and is
// NOT redeclared here.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope):
//   • $param URL interpolation and {{udf}} placeholder resolution (run-udf,
//     blob URLs, share tokens) — the `src` string is used as-is;
//   • the loading Spinner and X-Frame-Options caveats.
//
// Hardening (PR #79 review): the rendered iframe always carries a sandbox
// attribute (DEFAULT_IFRAME_SANDBOX below — the same posture as the app's
// constant of that name) and `src` must be an absolute http(s) URL; any other
// scheme (javascript:, data:, blob:, file:) renders an inline error placeholder
// instead of an iframe, so a hostile config (or a forged tool-result) cannot
// execute script in the bundle's own context via the src attribute.
// openfused reproduces the PROP CONTRACT and a lightweight render only: a config
// authored for the app pastes in and works because the prop names/types/
// semantics are a strict subset.

import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's IframePropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in
// via `.extend(UNIVERSAL_PROPS.shape)`. `src` is REQUIRED (matches the app's
// non-optional refined string); `content`/`height`/`sandbox` are intentionally
// NOT declared (the app has no such props).
export const iframeProps = z
  .object({
    src: z
      .string()
      .describe(
        "Absolute http or https URL, optionally with $param references, or an exact UDF placeholder like {{udf}} or {{udf?name=$param}}.",
      ),
    title: z
      .string()
      .optional()
      .describe("Accessible title for the embedded content."),
    allow: z
      .string()
      .optional()
      .describe(
        "Optional allow attribute (e.g. camera; microphone; geolocation).",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type IFrameProps = z.infer<typeof iframeProps>;

// -------------------------------------------------------------------- component

// Always applied: the embedded page may script itself and talk to its own
// origin, but cannot navigate the top page, open modals, or trigger downloads.
const DEFAULT_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups";

// Only absolute http(s) URLs may be embedded. javascript:/data:/blob:/file:
// (or an unparseable src, e.g. an unresolved {{udf}} placeholder) would run or
// load in a context the config author must not reach.
function safeIframeSrc(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? src : null;
}

function IFrame({ element }: ComponentRenderProps<IFrameProps>) {
  const { src, title, allow } = element.props;
  const style = (element.props as { style?: string }).style;

  const safeSrc = safeIframeSrc(src);
  if (safeSrc === null) {
    return (
      <div className="ofw-iframe ofw-iframe-blocked" style={parseStyle(style)}>
        iframe src must be an absolute http(s) URL
      </div>
    );
  }

  return (
    <iframe
      className="ofw-iframe"
      src={safeSrc}
      title={title ?? "embedded content"}
      allow={allow}
      sandbox={DEFAULT_IFRAME_SANDBOX}
      style={{
        width: "100%",
        height: "100%",
        border: 0,
        display: "block",
        // Default to the card background so a transparent or not-yet-loaded frame
        // blends with the dark UI instead of flashing white. The EMBEDDED document
        // still controls its own background/text once loaded — author it to match
        // (see the description); `style` can override this default.
        background: "var(--ofw-card)",
        ...parseStyle(style),
      }}
    />
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: IFrame,
    props: iframeProps,
    description:
      "Embed a web page or HTML-returning UDF in an iframe via http(s) URLs, $param URL templates, or {{udf}} placeholders. The embedded document is fully isolated and controls its OWN background and text color — the widget cannot style across the frame boundary. For an HTML-returning UDF, render a COMPLETE document that sets a dark background and light text to match the app (e.g. `<body style=\"background:#0d1219;color:#e7ecf3;font-family:system-ui\">…`); otherwise it renders on the browser default (white) and may be unreadable on the dark UI. Set `style:\"height: <px>\"` to size it. Use `image`/`html`/`text` instead for simple static content — reach for `iframe` only to embed a real external page or a full HTML page produced by a UDF.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
