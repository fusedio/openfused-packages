// maps/fused-map-renderer.tsx — the heavy renderer behind the `fused-map` widget.
// Mirrors the application's fused-map: a MapLibre basemap (no-token swap for Mapbox)
// + a deck.gl MapboxOverlay drawing the data layers (scatterplot / geojson / h3 /
// heatmap / arc), MVT/raster as native MapLibre tile layers, plus the chrome —
// layer panel, basemap switcher, color legend, scale + nav controls. maplibre-gl AND
// deck.gl load DYNAMICALLY (the widget module stays node-importable; the deployed
// bundle aliases the map widgets to a placeholder).
import { useCallback, useEffect, useRef, useState } from "react";
import type { IControl, Map as MLMap } from "maplibre-gl";
import { useFusedParamWithForm, parseStyle } from "@fusedio/widget-sdk";

import { basemapStyle, type BasemapName } from "./basemaps";
import { buildFusedLayer, type FusedDeckClasses, type FusedLayerDef } from "./fused-deck-layers";
import { paletteHex } from "./palettes";
import { FusedMapDataLoader } from "./fused-map-layer";

export interface FusedMapRenderProps {
  basemap?: string;
  centerLng: number;
  centerLat: number;
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  layers: FusedLayerDef[];
  showControls: boolean;
  showScale: boolean;
  showBasemapSwitcher: boolean;
  showLegend: boolean;
  showLayerPanel: boolean;
  param?: string;
  autoSend: boolean;
  autoSendDebounceMs: number;
  style?: string;
}

interface DeckOverlay extends IControl {
  setProps(props: Record<string, unknown>): void;
}
type Rows = ReadonlyArray<Record<string, unknown>>;
type LayerOverride = { visible: boolean; opacity?: number };

const fmt = (n: number): string => n.toFixed(6);

/** Map a Mapbox style URL (or a basemap name) to a no-token basemap. */
function basemapNameOf(basemap: string | undefined): BasemapName {
  const s = (basemap ?? "").toLowerCase();
  if (s.includes("satellite")) return "satellite";
  if (s.includes("light")) return "light";
  if (s === "blank") return "blank";
  return "dark";
}

interface ColorSpec {
  type?: string;
  attr?: string;
  domain?: number[];
  palette?: string;
}
function legendFor(layer: FusedLayerDef): { title: string; palette: string; domain: number[] } | null {
  const fc = layer.style?.fillColor as ColorSpec | undefined;
  if (!fc || typeof fc !== "object" || Array.isArray(fc) || fc.type !== "continuous") return null;
  if (layer.legend === false) return null;
  const title =
    (typeof layer.legend === "object" && layer.legend.title) || layer.name || fc.attr || "Value";
  return { title, palette: fc.palette ?? "Sunset", domain: fc.domain ?? [0, 1] };
}

export function FusedMapRenderer(props: FusedMapRenderProps) {
  const { centerLng, centerLat, zoom, layers, param, autoSend } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<DeckOverlay | null>(null);
  const deckRef = useRef<FusedDeckClasses | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [data, setData] = useState<Record<string, Rows>>({});
  const [basemap, setBasemap] = useState<BasemapName>(basemapNameOf(props.basemap));
  const [overrides, setOverrides] = useState<Record<string, LayerOverride>>({});

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

  // Per-layer tooltip (bool | string[]) → a single getTooltip over all layers.
  const getTooltip = useCallback(
    (info: { object?: unknown; layer?: { id?: string } }) => {
      if (!info.object) return null;
      const layerId = (info.layer?.id ?? "").replace("ofw-fused-", "");
      const def = layers.find((l) => l.id === layerId);
      const tip = def?.tooltip;
      if (!tip) return null;
      const o = info.object as { properties?: Record<string, unknown> } & Record<string, unknown>;
      const props2 = o.properties ?? o;
      const keys = Array.isArray(tip)
        ? tip
        : Object.keys(props2).filter((k) => k !== "geometry" && !k.startsWith("_"));
      const lines = keys
        .slice(0, 8)
        .map((k) => `<div><span style="opacity:.6">${k}</span> ${String(props2[k])}</div>`)
        .join("");
      return lines
        ? {
            html: `<div style="font:12px/1.4 ui-monospace,monospace;padding:6px 8px;background:#0b0e14;color:#e6e6e6;border:1px solid #2a2f3a;border-radius:6px">${lines}</div>`,
          }
        : null;
    },
    [layers],
  );

  // Add MVT / raster layers as native MapLibre tile sources (re-applied on style switch).
  const addTileLayers = useCallback((m: MLMap) => {
    for (const l of layers) {
      if ((l.type !== "mvt" && l.type !== "raster") || !l.tileUrl) continue;
      const srcId = `ofw-tile-${l.id}`;
      if (m.getSource(srcId)) continue;
      if (l.type === "raster") {
        m.addSource(srcId, { type: "raster", tiles: [l.tileUrl], tileSize: 256 });
        m.addLayer({ id: srcId, type: "raster", source: srcId, paint: { "raster-opacity": l.style?.opacity ?? 1 } });
      } else {
        m.addSource(srcId, { type: "vector", tiles: [l.tileUrl] });
        m.addLayer({
          id: srcId,
          type: "fill",
          source: srcId,
          "source-layer": l.sourceLayer ?? "default",
          paint: { "fill-color": "#E8FF59", "fill-opacity": l.style?.opacity ?? 0.4 },
        });
      }
    }
  }, [layers]);

  useEffect(() => {
    let cancelled = false;
    let m: MLMap | null = null;
    let resizeObs: ResizeObserver | undefined;
    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        await import("maplibre-gl/dist/maplibre-gl.css");
        const dMapbox = await import("@deck.gl/mapbox");
        const dLayers = await import("@deck.gl/layers");
        const dGeo = await import("@deck.gl/geo-layers");
        const dAgg = await import("@deck.gl/aggregation-layers");
        if (cancelled || !containerRef.current) return;
        deckRef.current = {
          ScatterplotLayer: dLayers.ScatterplotLayer as unknown as FusedDeckClasses["ScatterplotLayer"],
          GeoJsonLayer: dLayers.GeoJsonLayer as unknown as FusedDeckClasses["GeoJsonLayer"],
          ArcLayer: dLayers.ArcLayer as unknown as FusedDeckClasses["ArcLayer"],
          H3HexagonLayer: dGeo.H3HexagonLayer as unknown as FusedDeckClasses["H3HexagonLayer"],
          HeatmapLayer: dAgg.HeatmapLayer as unknown as FusedDeckClasses["HeatmapLayer"],
        };
        m = new maplibregl.Map({
          container: containerRef.current,
          style: basemapStyle(basemap),
          center: [centerLng, centerLat],
          zoom,
          minZoom: props.minZoom,
          maxZoom: props.maxZoom,
        });
        if (props.showControls) {
          m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        }
        if (props.showScale) m.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
        const Overlay = dMapbox.MapboxOverlay as unknown as new (p: Record<string, unknown>) => DeckOverlay;
        const overlay = new Overlay({ interleaved: true, layers: [], getTooltip });
        m.addControl(overlay);
        overlayRef.current = overlay;
        mapRef.current = m;
        m.on("load", () => {
          if (cancelled || !m) return;
          addTileLayers(m);
          setStatus("ready");
          setReady(true);
        });
        if (autoSend) {
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
      mapRef.current = null;
      m?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap switch: setStyle + re-add tile layers once the new style loads.
  // Guard on the LAST-applied basemap (the map is created with basemapStyle at
  // mount) so the first `ready` transition — and any addTileLayers identity
  // change — does NOT re-setStyle the already-applied basemap, which would reload
  // the style and flash/drop the tile layers (cursor #148).
  const appliedBasemapRef = useRef(basemap);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    if (appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    m.setStyle(basemapStyle(basemap));
    m.once("style.load", () => addTileLayers(m));
  }, [basemap, ready, addTileLayers]);

  // Rebuild deck layers when data / visibility / opacity change.
  useEffect(() => {
    const overlay = overlayRef.current;
    const deck = deckRef.current;
    if (!overlay || !deck || !ready) return;
    const deckLayers = layers
      .filter((l) => l.type !== "mvt" && l.type !== "raster")
      .filter((l) => (overrides[l.id]?.visible ?? l.visible) !== false)
      .map((l) => {
        const rows = (l._queryId && data[l._queryId]) || ((l.data as { features?: unknown[] })?.features ? geojsonToRows(l.data) : []);
        const o = overrides[l.id]?.opacity;
        const eff = typeof o === "number" ? { ...l, style: { ...l.style, opacity: o } } : l;
        return buildFusedLayer(deck, eff, rows);
      })
      .filter(Boolean);
    overlay.setProps({ layers: deckLayers, getTooltip });
  }, [data, ready, layers, overrides, getTooltip]);

  // No fixed pixel `height` here on purpose. The default height FLOOR lives in
  // `.ofw-fmap .ofw-map__frame { min-height }` (widget.css) so the map renders
  // one-shot without per-dashboard wrapper hacks. `height: "100%"` lets the map
  // GROW to fill a parent that pins an explicit height (canvas cards), while the
  // CSS min-height keeps it visible when `100%` would otherwise collapse to 0
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

  const legends = props.showLegend
    ? layers.map((l) => ({ id: l.id, lg: legendFor(l) })).filter((x) => x.lg)
    : [];

  return (
    <div className="ofw-fmap" style={{ position: "relative", ...parseStyle(undefined) }}>
      <div ref={containerRef} className="ofw-map__frame" style={wrapperStyle}>
        {status === "loading" ? <div className="ofw-map__overlay">Loading map…</div> : null}
        {status === "error" ? (
          <div className="ofw-map__overlay ofw-map__overlay--error">Map failed: {errMsg}</div>
        ) : null}

        {props.showBasemapSwitcher ? (
          <div className="ofw-fmap__basemaps">
            {(["dark", "light", "satellite"] as BasemapName[]).map((b) => (
              <button
                key={b}
                className={`ofw-fmap__chip${basemap === b ? " is-active" : ""}`}
                onClick={() => setBasemap(b)}
              >
                {b}
              </button>
            ))}
          </div>
        ) : null}

        {props.showLayerPanel && layers.length ? (
          <div className="ofw-fmap__panel">
            <div className="ofw-fmap__panel-title">Layers</div>
            {layers.map((l) => {
              const vis = overrides[l.id]?.visible ?? l.visible ?? true;
              return (
                <label key={l.id} className="ofw-fmap__layer-row">
                  <input
                    type="checkbox"
                    checked={vis}
                    onChange={(e) =>
                      setOverrides((o) => ({ ...o, [l.id]: { ...o[l.id], visible: e.target.checked } }))
                    }
                  />
                  <span className="ofw-fmap__layer-name">{l.name ?? l.id}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        {legends.length ? (
          <div className="ofw-fmap__legends">
            {legends.map(({ id, lg }) => (
              <div key={id} className="ofw-fmap__legend">
                <div className="ofw-fmap__legend-title">{lg!.title}</div>
                <div
                  className="ofw-fmap__legend-bar"
                  style={{ background: `linear-gradient(90deg, ${paletteHex(lg!.palette).join(",")})` }}
                />
                <div className="ofw-fmap__legend-domain">
                  <span>{lg!.domain[0]}</span>
                  <span>{lg!.domain[1]}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {layers
        .filter((l) => !!l._queryId)
        .map((l) => (
          <FusedMapDataLoader key={l._queryId} layer={l} onData={onData} />
        ))}
    </div>
  );
}

interface GeoFeature {
  properties?: Record<string, unknown>;
}
function geojsonToRows(data: unknown): ReadonlyArray<Record<string, unknown>> {
  const fc = data as { features?: GeoFeature[] };
  if (!fc?.features) return [];
  return fc.features.map((f) => ({ ...(f.properties ?? {}), geometry: JSON.stringify((f as { geometry?: unknown }).geometry) }));
}
