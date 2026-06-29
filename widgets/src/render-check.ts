// src/render-check.ts — headless RENDER validation for a widget config.
//
// WHY THIS EXISTS: the resolve path (`POST /api/exec/widget`) plans the config
// and runs the `{{udf}}` queries, but it never MOUNTS the React tree — so a
// render-time throw (e.g. a component-prop crash like an object passed where the
// `style` STRING is expected, which makes `parseStyle` call `.split` on a
// non-string) sails through "resolve" with an empty `errors` map. This closes the
// gap: it mounts the SAME component tree the app renders, through the SAME static
// bridge, and reports any throw — without a browser/WebGL (effects don't run under
// renderToStaticMarkup, so the heavy deck.gl/maplibre map imports never fire).
//
// The CLI wrapper lives in `scripts/render-check.ts`.

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { RenderTree, type UINode } from "./render";
import { WidgetDataStore, harvestInitialParams, type DepMap } from "./data-store";
import {
  createParamsStore,
  createStaticBridge,
  type WidgetData,
  type WidgetErrors,
} from "./static-bridge";

export interface ResolveEnvelope {
  data?: WidgetData;
  errors?: WidgetErrors;
  depMap?: DepMap;
}

export type RenderCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Mount the widget config the way the app does and report whether it throws.
 * Returns `{ ok: true }` on a clean render, or `{ ok: false, error }` with the
 * throw message. The `resolved` envelope (from `POST /api/exec/widget`) is
 * optional — render-time crashes (the class `resolve` is blind to) throw with or
 * without data.
 */
export function renderCheck(
  config: UINode,
  resolved: ResolveEnvelope = {},
): RenderCheckResult {
  // Build the bridge EXACTLY as the app's WidgetView does (app/src/ui/components/
  // WidgetView.tsx): a params store seeded from harvested defaults, a data store
  // over the (optional) resolved rows, a static bridge over both.
  const params = createParamsStore();
  for (const [name, value] of Object.entries(harvestInitialParams(config))) {
    params.set(name, value);
  }
  const store = new WidgetDataStore({
    data: resolved.data,
    errors: resolved.errors,
    depMap: resolved.depMap,
    config,
    harvestedParams: harvestInitialParams(config),
    params,
  });
  const bridge = createStaticBridge({ store, params });

  try {
    // renderToStaticMarkup runs every component's render body synchronously
    // (effects are skipped), so a synchronous render throw — the whole point of
    // this check — propagates out here and is caught. RenderTree wraps the config
    // in the FusedWidgetBridgeContext provider itself.
    renderToStaticMarkup(createElement(RenderTree, { config, bridge }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
