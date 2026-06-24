// maps/map-renderer.tsx — the heavy renderer behind the `map` widget. Mirrors the
// application's udf-map architecture: a MapLibre basemap (a no-token swap for Mapbox)
// with a deck.gl MapboxOverlay drawing the data layers. maplibre-gl AND deck.gl load
// DYNAMICALLY (keeps the widget module node-importable by the schema generator; the
// deployed bundle aliases the map widgets to a placeholder).
//
// Each `layers[]` entry is resolved by a MapDataLoader child (its UDF's rows); the
// rows flow up here, and ONE MapboxOverlay owns all the deck layers (rebuilt via
// buildDeckLayer when any layer's data changes). `param`/`sendParam` emit the viewport
// bounds as a "west,south,east,north" string (SQL-safe; the app's array form is illegal
// in OpenFused SQL — same key, narrowed value).
import { useCallback, useEffect, useRef, useState } from "react";
import type { IControl, Map as MLMap } from "maplibre-gl";
import { useFusedParamWithForm, parseStyle } from "@fusedio/widget-sdk";

import { basemapStyle, type BasemapName } from "./basemaps";
import { buildDeckLayer, type DeckClasses, type DeckLayerClass } from "./deck-layers";
import { MapDataLoader } from "./map-layer";

export interface MapLayerSpec {
  // A layer is bound by EITHER a `udf` shorthand (→ SELECT * FROM {{udf}}) OR an
  // explicit `sql` (DuckDB, may carry $param for slider-driven re-resolution).
  udf?: string;
  sql?: string;
  visible?: boolean;
  vizConfig?: Record<string, unknown>;
  _queryId?: string;
  _sql?: string;
}

export interface MapRenderProps {
  label?: string;
  param?: string;
  sendParam: boolean;
  centerLng: number;
  centerLat: number;
  zoom: number;
  mapStyle: BasemapName;
  layers: MapLayerSpec[];
  style?: string;
}

interface DeckOverlay extends IControl {
  setProps(props: Record<string, unknown>): void;
}
type OverlayClass = new (props: Record<string, unknown>) => DeckOverlay;

type Rows = ReadonlyArray<Record<string, unknown>>;

const fmt = (n: number): string => n.toFixed(6);

interface PickInfo {
  object?: { properties?: Record<string, unknown> };
}
function tooltipFor(info: PickInfo): { html: string } | null {
  const props = info.object?.properties;
  if (!props) return null;
  const lines = Object.entries(props)
    .filter(([k]) => k !== "geometry" && !k.startsWith("_"))
    .slice(0, 6)
    .map(([k, v]) => `<div><span style="opacity:.6">${k}</span> ${String(v)}</div>`)
    .join("");
  return lines
    ? {
        html: `<div style="font:12px/1.4 ui-monospace,monospace;padding:6px 8px;background:#0b0e14;color:#e6e6e6;border:1px solid #2a2f3a;border-radius:6px">${lines}</div>`,
      }
    : null;
}

export function MapRenderer(props: MapRenderProps) {
  const { label, param, sendParam, centerLng, centerLat, zoom, mapStyle, layers } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<DeckOverlay | null>(null);
  const deckRef = useRef<DeckClasses | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [data, setData] = useState<Record<string, Rows>>({});

  const onData = useCallback((id: string, rows: Rows) => {
    setData((d) => (d[id] === rows ? d : { ...d, [id]: rows }));
  }, []);

  const { setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: "",
    broadcastDefaultValue: false,
    debounceMs: 0,
  });
  const emit = useCallback(
    (m: MLMap) => {
      const b = m.getBounds();
      setValue(`${fmt(b.getWest())},${fmt(b.getSouth())},${fmt(b.getEast())},${fmt(b.getNorth())}`);
    },
    [setValue],
  );

  useEffect(() => {
    let cancelled = false;
    let m: MLMap | null = null;
    let resizeObs: ResizeObserver | undefined;
    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        await import("maplibre-gl/dist/maplibre-gl.css");
        const deckMapbox = await import("@deck.gl/mapbox");
        const deckLayers = await import("@deck.gl/layers");
        if (cancelled || !containerRef.current) return;
        const MapboxOverlay = deckMapbox.MapboxOverlay as unknown as OverlayClass;
        deckRef.current = {
          GeoJsonLayer: deckLayers.GeoJsonLayer as unknown as DeckLayerClass,
        };
        m = new maplibregl.Map({
          container: containerRef.current,
          style: basemapStyle(mapStyle),
          center: [centerLng, centerLat],
          zoom,
        });
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        const overlay = new MapboxOverlay({ interleaved: true, layers: [], getTooltip: tooltipFor });
        m.addControl(overlay);
        overlayRef.current = overlay;
        m.on("load", () => {
          if (!cancelled) {
            setStatus("ready");
            setReady(true);
          }
        });
        if (sendParam) {
          m.on("moveend", () => {
            if (m) emit(m);
          });
        }
        resizeObs = new ResizeObserver(() => m?.resize());
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
      resizeObs?.disconnect();
      overlayRef.current = null;
      deckRef.current = null;
      m?.remove();
    };
    // Init once; basemap/center/zoom are first-paint only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the deck layers whenever any layer's data changes (deck reconciles by id).
  useEffect(() => {
    const overlay = overlayRef.current;
    const deck = deckRef.current;
    if (!overlay || !deck || !ready) return;
    const deckLayers = layers
      .filter((l) => l.visible !== false)
      .map((l, i) => {
        const id = l._queryId ?? l.udf ?? `layer-${i}`;
        const rows = (l._queryId && data[l._queryId]) || [];
        return buildDeckLayer(deck, id, rows, l.vizConfig);
      });
    overlay.setProps({ layers: deckLayers });
  }, [data, ready, layers]);

  // No fixed pixel `height` here on purpose. The default height FLOOR lives in
  // `.ofw-map__frame { min-height }` (widget.css) so the map renders one-shot
  // without per-dashboard wrapper hacks. `height: "100%"` lets the map GROW to
  // fill a parent that pins an explicit height (canvas cards), while the CSS
  // min-height keeps it visible when `100%` would otherwise collapse to 0
  // against an auto-height ancestor. Author `style` is spread last, so an
  // explicit `height`/`min-height` from the author always wins.
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
      </div>
      {layers
        .filter((l) => l.visible !== false)
        .map((l, i) => (
          <MapDataLoader key={l._queryId ?? l.udf ?? i} layer={l} onData={onData} />
        ))}
    </div>
  );
}
