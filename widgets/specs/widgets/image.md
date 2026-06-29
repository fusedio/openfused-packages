# `image`

> Display an image from a URL, base64 data URL, or signable storage path.

## Why
`image` paints a single image from a URL, base64 data URL, or signable storage path (e.g. `s3://bucket/image.png`) directly into the widget. Authors reach for it to embed a static visual — a rendered chart export, a map snapshot, a logo, an inline data-URL — alongside other widgets. Its ROLE is **display**: it is not data-bound, runs no SQL, and writes no param. App-parity: it is a strict, paste-compatible SUBSET of the application's `image` component — identical prop names/types/semantics (`src`, `alt`, `objectFit`) plus the universal `style`, with FEWER props (no `useMediaSrc` resolution, loading/error states, or baseui Spinner).

## Expectation
- Renders a plain `<img>` with `src` passed VERBATIM (no client-side resolution/signing of storage paths), `alt` defaulting to `""` when omitted, and an inline style of `{ maxWidth: "100%", objectFit }` with the parsed `style` declarations spread OVER it (user declarations win last).
- `objectFit` defaults to `"contain"` and applies as the CSS `object-fit` value; it is one of `contain` / `cover` / `fill` / `none` / `scale-down`.
- **Missing `src` guard:** when `src` is falsy, renders an in-card placeholder element with `role="alert"` reading `image: missing src` — a visible placeholder, never a broken image and never a blank widget.
- NOT data-bound: there is no `sql` prop and no `_queryId`; the component never reads result columns.
- NOT an input: writes nothing to the param store.
- Deliberate behavioural subset vs the Fused app: the app resolves `src` through `useMediaSrc` (signable storage paths, loading + error states, a baseui Spinner); fused keeps the lightweight `<img src={src}>` path only. This is a CONFIG-compat mapping (same JSON props accepted), NOT a render-fidelity mapping — signable-path `src` values are passed straight to `<img>` and will only display if the URL is already directly fetchable by the browser.
- Renders everywhere (no native-app-only restriction).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `src` | `string` (required) | — | Image URL, base64 data URL, or signable storage path (e.g. `s3://bucket/image.png`). |
| `alt` | `string` (optional) | — | Accessible description of the image (renders `alt=""` when omitted). |
| `objectFit` | `enum(contain, cover, fill, none, scale-down)` (optional) | `"contain"` | How the image fits its container. |
| `style` | `string` (optional) | — | Inline CSS declaration string, parsed and merged OVER the component defaults (`maxWidth: 100%`, `objectFit`). |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- Uses no ui-kit primitives — renders a raw `<img>` and, on the missing-`src` path, a raw placeholder element. Depends only on `@fusedio/widget-sdk` (its style parser plus `defineComponent` / `ComponentRenderProps`).
- The `style` value is read off the node's props via a cast because the inferred props type still carried a legacy `css` key at authoring time; the live prop is `style`.
