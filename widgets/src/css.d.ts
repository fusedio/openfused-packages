// Ambient declaration so TypeScript accepts side-effect / dynamic CSS imports
// whose package "exports" map omits the `.css` subpath (e.g. maplibre-gl's
// stylesheet, imported dynamically in maps/map-bounds-renderer.tsx). The bundler
// (esbuild) and the app (vite) load the real file; tsc only needs the module to
// be declared so resolution does not fail.
declare module "*.css";
