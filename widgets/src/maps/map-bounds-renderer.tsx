// maps/map-bounds-renderer.tsx — the heavy MapLibre renderer behind the
// `map-bounds` widget (widgets/map-bounds.tsx). Kept OUT of widgets/ for two
// reasons:
//   1. maplibre-gl is imported DYNAMICALLY (inside the mount effect), so the
//      widget module stays node-importable by the schema generator
//      (scripts/generate.ts loads every widget for its prop schema and must not
//      pull a browser-only WebGL lib), and the native app code-splits the lib.
//   2. The deployed self-contained bundle never reaches this file — build.mjs
//      aliases the map widgets to _map-placeholder in the render-bundle build.
//
// Behaviour mirrors the application's `map-bounds` subset: an interactive map
// whose viewport bounds are written to a param as a "west,south,east,north"
// string (6dp) — a SQL-safe scalar, usable as $param (an array param would be
// rejected by the SQL layer, json-ui-data.md). Emits on a manual button press,
// or automatically (debounced) on move when `autoSend` is set.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useFusedParamWithForm, parseStyle } from "@fusedio/widget-sdk";
import { Button } from "@kit";

import { basemapStyle, type BasemapName } from "./basemaps";

export interface MapBoundsRenderProps {
  param?: string;
  label?: string;
  centerLng: number;
  centerLat: number;
  zoom: number;
  mapStyle: BasemapName;
  buttonLabel: string;
  autoSend: boolean;
  autoSendDebounceMs: number;
  style?: string;
}

const fmt = (n: number): string => n.toFixed(6);

export function MapBoundsRenderer(props: MapBoundsRenderProps) {
  const { param, label, centerLng, centerLat, zoom, mapStyle, buttonLabel, autoSend, autoSendDebounceMs } =
    props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  // Param write only — bounds flow out; the map takes no data in. debounceMs 0
  // because the move handler already debounces before calling setValue.
  const { setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: "",
    broadcastDefaultValue: false,
    debounceMs: 0,
  });

  const emit = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setValue(`${fmt(b.getWest())},${fmt(b.getSouth())},${fmt(b.getEast())},${fmt(b.getNorth())}`);
  }, [setValue]);

  // Mount the map once. maplibre-gl + its stylesheet load dynamically so this
  // file never forces the WebGL lib into the generator or the deployed bundle.
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObs: ResizeObserver | undefined;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: basemapStyle(mapStyle),
          center: [centerLng, centerLat],
          zoom,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        mapRef.current = map;
        map.on("load", () => {
          if (!cancelled) setStatus("ready");
        });
        if (autoSend) {
          map.on("moveend", () => {
            if (autoSendDebounceMs > 0) {
              clearTimeout(moveTimer);
              moveTimer = setTimeout(emit, autoSendDebounceMs);
            } else {
              emit();
            }
          });
        }
        // Keep the GL canvas sized to its container (recorded map fix,
        // json-ui-widgets-batch1.md § Deferred: maps).
        resizeObs = new ResizeObserver(() => map?.resize());
        resizeObs.observe(containerRef.current);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrMsg(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(moveTimer);
      resizeObs?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
    // Init-once: post-mount prop edits are not re-applied (simple widget lifecycle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default height FLOOR lives in `.ofw-map__frame { min-height }` (widget.css);
  // `height: "100%"` lets the frame fill a parent that pins an explicit height
  // while the CSS min-height keeps it visible when `100%` collapses to 0 against
  // an auto-height ancestor. Author `style` (spread last) always wins.
  const wrapperStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: 8,
    ...parseStyle(props.style),
  };

  return (
    <div className="ofw-map">
      {label ? <div className="ofw-map__label">{label}</div> : null}
      <div ref={containerRef} className="ofw-map__frame" style={wrapperStyle}>
        {status === "loading" ? <div className="ofw-map__overlay">Loading map…</div> : null}
        {status === "error" ? (
          <div className="ofw-map__overlay ofw-map__overlay--error">Map failed: {errMsg}</div>
        ) : null}
        {!autoSend ? (
          <div className="ofw-map__actions">
            <Button size="sm" onClick={emit} disabled={status !== "ready"}>
              {buttonLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
