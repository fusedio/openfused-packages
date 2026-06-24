// maps/basemaps.ts — no-token MapLibre basemap styles.
//
// OpenFused maps render with MapLibre GL and NO Mapbox token (the chosen posture,
// spec/ui/json-ui.md § Component catalog / json-ui-widgets-batch1.md § Deferred:
// maps). Each named style is a raster style backed by a free, no-token tile
// source so a config never needs a secret:
//   • dark / light → CARTO basemaps (no token; match the app's dark aesthetic)
//   • satellite    → ESRI World Imagery (no token)
//   • blank        → a flat background, no tiles (fully offline)
//
// These load tiles from external CDNs, which is fine for the NATIVE app render
// (openfused up / parley) — only the deployed self-contained bundle forbids
// external access, and that surface renders a placeholder instead of a map
// (build.mjs). A deployed-serve map delivery (follow-up) must allowlist whichever
// tile domain is chosen.
//
// NOTE: the `maplibre-gl` import here is TYPE-ONLY (erased at build/generate), so
// this module carries no runtime dependency on the WebGL lib — it returns plain
// style objects.
import type { StyleSpecification } from "maplibre-gl";

export type BasemapName = "dark" | "light" | "satellite" | "blank";

const carto = (variant: string): StyleSpecification => ({
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: ["a", "b", "c", "d"].map(
        (s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
      ),
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
});

const satellite: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

const blank: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0e14" } }],
};

/** Resolve a basemap name to a no-token MapLibre style object (defaults to dark). */
export function basemapStyle(name: BasemapName = "dark"): StyleSpecification {
  switch (name) {
    case "light":
      return carto("light_all");
    case "satellite":
      return satellite;
    case "blank":
      return blank;
    case "dark":
    default:
      return carto("dark_all");
  }
}
