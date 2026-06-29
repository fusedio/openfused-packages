# `file-upload`

> File picker that reads selected files to data URLs and writes them to a param (single data URL, or JSON array when multiple).

## Why
`file-upload` is an INPUT component: a browser file picker that lets the human pick one or more local files and broadcasts their contents into the param store, where downstream nodes can read them. The author reaches for it when a widget needs user-supplied file content (an image, a CSV, JSON) rather than a typed/selected value. It is a config-compatible SUBSET of the Fused application's `file-upload` — identical prop NAMES/TYPES/SEMANTICS for the props it keeps (`param`, `label`, `accept`, `multiple`, `maxSizeMb`), fewer props, never extra. It is NOT a render-fidelity mapping: the app uploads to an S3/fd/gs destination and broadcasts a JSON array of `{ path, fileName }`, whereas fused has no storage layer and instead reads files in-browser via `FileReader.readAsDataURL` and broadcasts the data URL(s) directly.

## Expectation
- Renders a labelled `Field` (label above) wrapping a native `<input type="file">`. `accept` is passed to the picker's `accept` attribute; `multiple` is passed to its `multiple` attribute (default `false`). The input gets a stable `id` derived from `param` (a fixed fallback when `param` is unset) so the label's `htmlFor` targets it.
- Below the input, when files have been accepted, shows a small caption: the single file name for one file, or `"N files selected"` for many. When a guard message is present, shows it in an error block with `role="alert"`.
- INPUT value shape broadcast to the param store: a SINGLE data URL **string** for one file; a **JSON-stringified array of data URL strings** when `multiple`. Bound via `useFusedParamWithForm` over a string value — Form-ready (defers broadcast inside a `Form`), never seeds an empty value onto the canvas, and broadcasts immediately (no debounce, since selecting files is a deliberate single action).
- Non-scalar SQL-safety: when `multiple` is set the broadcast value is a JSON-stringified array of (typically very large) data URL strings. Even the single-file case writes a long `data:` URL string. Such values MUST NOT be referenced in SQL — `$param` is plain text substitution, so injecting a data URL (or its JSON array) into SQL is invalid/unsafe. Treat the param as opaque file payload consumed by code, not SQL.
- `maxSizeMb` guard (default `5`): files over `maxSizeMb * 1024 * 1024` bytes are skipped, never thrown. If ALL selected files exceed the limit, sets message `"All files exceed the <N> MB limit and were skipped."` and broadcasts nothing.
- Read errors are caught: a `FileReader` error yields no data URL for that file rather than throwing. If no file reads successfully, sets message `"Could not read the selected file(s)."` and broadcasts nothing. If some files are skipped/unreadable but at least one succeeds, shows `"<N> file(s) skipped (over <N> MB or unreadable)."` and broadcasts the successful ones.
- The native input is reset (`e.target.value = ""`) after each change so re-selecting the same file fires `onChange` again.
- Selecting zero files (empty `FileList`) is a no-op.
- This is a display/input component rendered EVERYWHERE (no native-app-only restriction; no map tiles).
- Deliberate behavioural subset vs the Fused app: app-only props are intentionally omitted (`destinationPath`, `sourceMode`, `contentParam`, `autoUpload`, `uploadLabel`, `disabled`, `readOnly`); a pasted app config that sets them is silently ignored here. The broadcast payload also differs by design (data URL(s) instead of the app's `{ path, fileName }` array) because fused has no storage layer.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `param` | `string` | — | Canvas parameter name to sync with (or form field name inside a `Form`). Broadcasts a data URL string (single file) or a JSON-stringified array of data URLs (multiple). |
| `label` | `string` | — | Label text displayed above the file upload widget. |
| `accept` | `string` | — | Optional `accept` attribute for the browser file picker (e.g. `"image/*"` or `".csv,.json"`). |
| `multiple` | `boolean` | `false` | Allow selecting multiple files. |
| `maxSizeMb` | `number` (positive) | `5` | Maximum size per file in megabytes; files over the limit are skipped with a message (never throws). |
| `style` | `string` | — | Inline CSS declaration string parsed and merged over the component's defaults. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts a single data URL string, or a JSON-stringified array of data URL strings when `multiple`, to `props.param`).

## Notes
- Uses the shared `Field` primitive for the label/`htmlFor` wrapper, with the standard input and error-message styling. The selected-file caption renders as small muted-grey text.
- Param binding is `useFusedParamWithForm` (not plain `useFusedParam`), giving the same broadcast API while deferring inside a `Form`.
