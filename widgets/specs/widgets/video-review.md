# `video-review`

> Timestamped video feedback for agent-made videos — built for the parley loop. Plays a video with a scrub bar (showing an audio waveform of the source), comment pins, and keyboard shortcuts (space play, ←/→ ±2s, ,/. frame step, 1/2 = 1×/2× speed, C note); the human drops timecoded notes ({t, text}) that are written to `param` as an array and stream to the agent via ordinary params events. Past rounds passed in `rounds` get approve / re-flag QA buttons (verdicts written to `qaParam`; a re-flag re-opens the comment into the open array). Pair with a `button` for the explicit submit signal. Feedback params are arrays/objects — never reference them in SQL.

## Why
`video-review` is a FEEDBACK INPUT primitive for the parley loop (`spec/feedback/local.md` § The parley): an agent producing a video pushes a view carrying this component, the human scrubs the clip and drops timecoded notes, and those notes ride the ordinary debounced `params` channel back to the agent, which re-edits and pushes the next cut. It also QAs the agent's prior round of fixes — past rounds passed in `rounds` get ✓ approve / ↺ re-flag buttons, and a re-flag re-opens that comment into the live work list. Like `button`, this is an Fused-OWNED feedback primitive — NOT an app-parity component (the contract is owned by `spec/ui/json-ui.md` § Actions & selection). It never reports an action itself: pair it with a `button` (`{action: "re-edit", submit: …}`) for the explicit "send this round" signal.

## Expectation
- Renders a `Card` (title from `title`) wrapping an HTML `<video>` (`src` passed verbatim, `playsInline`, click-to-play), a control bar (play/pause, a `mm:ss.t / mm:ss.t` timecode, four speed buttons 0.5×/1×/1.5×/2×, a "+ Note (C)" button), a scrub timeline with comment pins, an audio waveform, a keyboard-shortcut hint line, an inline note composer, and a notes/rounds list.
- **Not data-bound** — no `sql` prop; the component reads no result columns and runs no query.
- Missing `src` short-circuits to a `Card` (with `title`) containing an `EmptyState` labelled `"video-review: missing src"` — the placeholder path, like `image`.
- INPUT (open comments): broadcasts to `param` an **ARRAY of `{t, text}`** objects (`t` = seconds into the video, rounded to 2 decimals when authored via the composer; `text` is the trimmed note). Comments are kept sorted ascending by `t` on every write. Because the value is an array, it is FEEDBACK ONLY — **never reference `param` in SQL** (`$param` is text substitution).
- INPUT (QA verdicts): broadcasts to `qaParam` an **OBJECT map** `{"<n>-<idx>": "approved" | "reflagged"}` keyed by round number + comment index. Object value — again **never reference `qaParam` in SQL**. With `qaParam` unset the hook degrades to plain local state, so the buttons still work visually and a re-flag still re-opens the comment.
- Default/seed discipline (mirrors `slider`'s seed-if-absent behavior): `defaultValue` is seeded into `param` on mount only when the raw `defaultValue` prop is actually present (`!== undefined`) — an unauthored widget never broadcasts `[]`. Pass `[]` explicitly to make the param present from first paint. The planner harvests `defaultValue` for first-paint params. `qaParam` is seeded locally with `{}` but is never broadcast on mount.
- Untyped inbound values are sanitized: incoming `param`/`defaultValue`/`rounds[].comments` are filtered to valid `{t: finite number, text: string}` comments; `qaValue` is reduced to only `"approved"`/`"reflagged"` entries (non-object/array → `{}`).
- `rounds` (display-only) render newest-round-first; each past comment gets a pin and, while `pending`, ✓ "Looks good" (→ `approved`) and ↺ "Still needs fix" (→ `reflagged`) buttons. Re-flag appends a new open comment `{t, text: "<text> (re-flagged)"}` so the open array is always the agent's full work list. Round headers show `(done/total done)`.
- Player behaviour: click-to-play/pause; speed buttons set `playbackRate`; click or press-and-drag (pointer-captured) on the track to seek/scrub; double-click the track seeks there AND opens the composer; comment pins seek to their timestamp and pause; note timestamps in the list seek + pause; a ✕ deletes an open note. Composer opens at the current playhead (pauses video), focuses the textarea, saves on ⌘/Ctrl+Enter, cancels on Escape.
- Keyboard shortcuts are scoped to the focused widget (`onKeyDown` on the wrapper, never the document) and are ignored while a TEXTAREA/INPUT is focused: space (play/pause), ←/→ (±2 s, ±10 s with Shift), `,`/`.` (±1 frame at 1/24 s), `1`/`2` (1×/2× speed), `c`/`C` (note at playhead).
- Performance: the playhead, timecode, progress fill, and waveform played/unplayed split are updated by direct DOM/canvas writes from a `requestAnimationFrame` loop while playing — no per-frame React re-render of the notes list.
- Waveform: the source audio is fetched and decoded once per `src` (Web Audio API), downsampled to 480 peak bars; the played portion is tinted with the accent color (amber by default), the rest with a faint muted color. Best-effort: a cross-origin/non-OK fetch, an audio-less video, or a decode failure leaves the track waveform-less — **never an error**.
- Parley re-push guard: when `src` swaps on the same instance, `duration`/`playing`/`rate` reset and `playbackRate` reverts to 1× so a new cut never inherits the prior clip's timeline; `onLoadedMetadata` repopulates `duration` for the new clip.
- Renders everywhere (no map dependency; not native-app-only).

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `src` | `string` | — | Video URL (http(s), `data:`, or anything a `<video>` src accepts); passed verbatim. |
| `title` | `string` (optional) | — | Card title shown above the player. |
| `param` | `string` (optional) | — | Param receiving the open review comments as an ARRAY of `{t, text}` (t = seconds). Feedback only — never reference an array param in SQL. |
| `defaultValue` | `array<{t: number, text: string}>` (optional) | — | Initial open comments seeded into the param on mount; use `[]` to make the param present from first paint. |
| `rounds` | `array<{n: number, label?: string, comments: array<{t: number, text: string}>}>` (optional) | — | Past addressed feedback rounds, newest-first display; each comment gets approve / re-flag QA buttons (re-flag re-opens it into the open-comments param). |
| `qaParam` | `string` (optional) | — | Param receiving QA verdicts on past-round comments as an OBJECT map `{"<round>-<index>": "approved"\|"reflagged"}`. Feedback only — never reference it in SQL. |
| `style` | `string` (optional) | — | Inline CSS declaration string, parsed into a style object and merged over the component's default styles. |

- **Data-bound:** no.
- **Writes param:** yes (`writesParam: true`; broadcasts an ARRAY of `{t, text}` to `props.param` and an OBJECT map `{"<n>-<idx>": "approved"|"reflagged"}` to `props.qaParam`).

## Notes
- ui-kit / render primitives: `Card` + `EmptyState`; the player UI is local markup styled with the package's own classes, the accent color, and a faint muted color.
- Open comments and QA verdicts are written through `useFusedParam` (two separate hooks); the component does not use `useFusedParamWithForm`.
- Parley role: notes stream live to the agent via debounced `params` events as they are written; the explicit "send this round" signal comes from a paired `button`, not from this component. The agent bakes the round it just addressed into the NEXT pushed config's `rounds` (params reset per push).
- Two non-scalar params (`param` array, `qaParam` object) — both are SQL-unsafe by construction; this is the canonical example of selection-as-feedback that must stay off the `$param` text-substitution path.
