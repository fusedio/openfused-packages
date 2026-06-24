# `video`

> Display a video from a URL or base64 data URL.

## Why
`video` paints a single HTML `<video>` element from a URL or inline data URL — the media equivalent of `image`. An author reaches for it to embed a clip directly in a widget card (e.g. a rendered animation, a screen recording, a UDF-produced video asset). It is a pure **display** component: not data-bound, writes no param. App-parity: its prop contract is a strict, paste-compatible SUBSET of the Fused application's `video` component (identical prop names/types/semantics — `src`, `poster`, `controls`, `autoPlay`, `loop`, `muted`, `objectFit` — plus the universal `style`); the app-only `alt`/`playsInline` props are intentionally omitted.

## Expectation
- Renders a `<video>` inside a wrapper `<div>`. The wrapper defaults to `position: relative; width: 100%; overflow: hidden`, with the parsed `style` prop spread OVER those defaults (user declarations win last). The inner `<video>` is `display: block; width: 100%; maxWidth: 100%` with `objectFit` from the prop.
- `src` is passed verbatim to the `<video src>` attribute — no resolution, signing, or refresh. This is the deliberate behavioural subset: the Fused app resolves `src` through `useMediaSrc` (signable storage paths, loading/error states, signed-URL refresh on network error); openfused keeps the lightweight plain `<video>` path with `src` set directly, so signable-path src values are passed through unchanged. CONFIG-compat, not render-fidelity.
- The native `<video>` element is rendered with `controls` (default `true`), `autoPlay` (default `false`), `loop` (default `false`), `muted` (default `false`), and `objectFit` (default `"contain"`). `playsInline` is hard-coded on the element (it is not an exposed prop).
- Empty/missing guard: a falsy `src` renders an in-card placeholder reading `video: missing src` (marked as an alert) — never a broken `<video>`; the widget is never blanked.
- Not DATA-BOUND: no `sql` prop, reads no result columns, the resolver stamps no `_queryId`.
- Not an INPUT: `writesParam: false`; broadcasts nothing to the param store.
- Renders everywhere (no native-app-only restriction; no deployed-bundle placeholder).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `src` | string | — | Video URL or base64 data URL (e.g. `https://…/clip.mp4` or `data:video/mp4;base64,…`). Required. |
| `poster` | string (optional) | — | Poster image URL shown before playback starts. |
| `controls` | boolean (optional) | `true` | Whether to show native playback controls. |
| `autoPlay` | boolean (optional) | `false` | Whether the video starts playing automatically. |
| `loop` | boolean (optional) | `false` | Whether the video loops after ending. |
| `muted` | boolean (optional) | `false` | Whether the video is muted (required for autoplay in most browsers). |
| `objectFit` | enum(`contain`, `cover`, `fill`, `none`, `scale-down`) (optional) | `"contain"` | How the video fits its container. |
| `style` | string (optional) | — | Inline CSS declaration string, parsed and merged over the wrapper's default styles (user wins). |

- **Data-bound:** no.
- **Writes param:** no.

## Notes
- Inline-style parsing is provided by `@fusedio/widget-sdk`; the component is authored against the SDK plus the package's local primitives only (`UNIVERSAL_PROPS`, `ComponentDef`).
- Mirrors the `image` widget (the canonical display media widget) in structure: reads the single `element` prop, extends the props schema with `UNIVERSAL_PROPS`, and is defined via `defineComponent` with `writesParam: false`.
