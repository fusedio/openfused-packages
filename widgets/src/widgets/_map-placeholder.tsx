// widgets/_map-placeholder.tsx — the deployed-bundle stand-in for map widgets.
//
// Map widgets (map-bounds, map, …) render with MapLibre GL + deck.gl: browser
// WebGL libs that load external tiles and (in the application) need a token. The
// self-contained deployed-serve bundle (widget.html) deliberately ships none of
// that — it has no external-access posture and no token channel (spec/ui/json-ui.md
// § Non-goals, json-ui-widgets-batch1.md § Deferred: maps). build.mjs aliases every
// map widget module to THIS file in the render-bundle build ONLY, so the bundle
// compiles clean and a deployed config naming a map renders a clear notice rather
// than a blank/broken canvas. The REAL maps render in the native app
// (openfused up / parley), which renders the same configs without this bundle.
//
// One ComponentDef serves every map type — at render the bundle reads only
// `.component`; `props`/`writesParam` are used by the generator, which loads the
// REAL widget modules, not this placeholder. Imports are allowlist-clean (zod is
// stubbed in the bundle; @fusedio/widget-sdk + ./types are permitted siblings).
import { z } from "zod";
import { defineComponent, type ComponentRenderProps } from "@fusedio/widget-sdk";

import type { ComponentDef } from "./types";

function MapPlaceholder({ element }: ComponentRenderProps) {
  const props = element.props as { label?: string; title?: string };
  const heading = props.label ?? props.title;
  return (
    <div className="ofw-map-placeholder" role="img" aria-label="Map preview (app only)">
      <div className="ofw-map-placeholder__title">Map preview</div>
      {heading ? <div className="ofw-map-placeholder__name">{heading}</div> : null}
      <div className="ofw-map-placeholder__body">
        Maps render in the OpenFused app. Open this widget with the app or the parley to
        view it; deployed-serve map rendering is coming in a follow-up.
      </div>
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: MapPlaceholder,
    props: z.object({}),
    description: "Deployed-bundle placeholder for map widgets (maps render in the app).",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
