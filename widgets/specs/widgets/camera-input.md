# `camera-input`

> Camera input that captures a photo as a JPEG data URL and syncs it to a param.

## Why
`camera-input` lets an author capture a still frame from the device camera (via browser-native `getUserMedia`) and broadcast it to the param store as a JPEG data-URL string. It is an INPUT component — reach for it when a widget needs a user-supplied photo as input to downstream SQL/UDFs or as a form field. Its prop contract is a strict, paste-compatible SUBSET of the Fused application's `camera-input` (identical names/types/semantics: `param`, `label`, `facingMode`; fewer props). It is form-aware: inside a built-in Form it acts as a form field; outside one it is a two-way canvas param binding.

## Expectation
- Renders inside a `Field` (label + `htmlFor`), wrapping a preview box and a single action button:
  - **Captured state** (`value` non-empty): shows an `<img src={value}>` of the JPEG data URL, plus a `Retake` button.
  - **Live state** (`stream` active, no value): shows the live `<video>` preview (`autoPlay muted playsInline`), plus a `Capture` button (primary).
  - **Idle state** (no stream, no value): shows a muted `No photo captured` placeholder, plus a `Start camera` button (primary).
- Capture flow: `Start camera` calls `getUserMedia({ video: { facingMode }, audio: false })`; `Capture` draws the current video frame onto an off-screen `<canvas>` (`video.videoWidth || 640` × `video.videoHeight || 480`) and stores `canvas.toDataURL("image/jpeg")` via `setValue`, then stops the stream. `Retake` clears the value (`setValue("")`) and restarts the camera.
- INPUT value shape: a **scalar string** — a `data:image/jpeg;base64,…` data URL. Initial `defaultValue` is `""`; `broadcastDefaultValue: false` so an empty data URL is never seeded onto the canvas. `debounceMs: 0` (a capture is a deliberate single action). Because the value is a (long) scalar string it is technically `$param`-referenceable, but as an image data URL it is not meaningfully usable in SQL.
- Edge cases & guards:
  - No camera / no `getUserMedia`: sets the in-card error `"Camera is not available in this browser."` — never throws.
  - `getUserMedia` rejection: in-card error `"Could not access camera."`.
  - `video.play()` rejection: in-card error `"Could not start camera preview."`.
  - Tainted-canvas `toDataURL` throw: caught and reported as `"Could not capture photo."` — a press can never throw uncaught.
  - All errors render in an in-card `role="alert"` block; the widget is never blanked.
  - The media stream is always stopped on unmount (and before each `startCamera`).
- Deliberate behavioural subset vs the Fused app (app-only machinery intentionally out of scope): the file-picker fallback (`Send photo`), `imageFormat`/`quality` knobs, `disabled`/`readOnly`, and the rich retake/clear button matrix. fused keeps only the `getUserMedia → capture` path and degrades gracefully.
- WHERE it renders: everywhere the renderer runs that exposes `navigator.mediaDevices.getUserMedia` (a live browser with camera permission). No native-app-only restriction.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | `string` (optional) | — | Canvas parameter name to sync with, or form field name inside a Form. Captured photos are stored as JPEG data URL strings. |
| `label` | `string` (optional) | — | Label text displayed above the camera input. |
| `facingMode` | `enum("user", "environment")` (optional) | `"environment"` | Preferred camera direction: `"user"` (front) or `"environment"` (rear). |
| `style` | `string` (optional) | — | Inline CSS declaration string, parsed and merged over component defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a scalar JPEG data-URL `string` to `props.param`).

## Notes
- Host-state seam: binds the param via `useFusedParamWithForm` as a `string` with default `""`, broadcast deferred, and no debounce — the form-ready variant of `useFusedParam` (defers broadcast and mirrors into the form store inside a Form; identical to `useFusedParam` outside one).
- Primitives: a ui-kit Field supplies the label + layout; the action buttons and the error block use the kit's button and error-message styling; an off-screen, visually-hidden `<canvas>` serves as the capture target.
- A per-instance element id (derived from `param`, falling back to a local placeholder) ties the Field's `htmlFor` to the preview `<video>`.
