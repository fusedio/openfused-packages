# Widget interaction audit — the coverage spec

The normative checklist for the **interaction QA harness**: every JSON-UI widget,
every user interaction it affords, across every viewport size, in default
(no-override) settings. The verifier agent (`scripts/widget-interaction-audit/`)
drives the live widget render, performs each interaction, screenshots before/after,
and analyzes the pair for the expected visual outcome. A widget passes only when
**every** row in its matrix passes at **every** size.

This exists because unit tests assert config→render, not *interaction*. The gaps
that motivated it (real, observed): **chart tooltips don't appear on hover/click**,
and **dropdown menus sometimes don't open**. Those are interaction regressions a
render test can't see.

---

## 1. The coverage matrix

Every widget is audited along three axes — the product of all three must hold:

**Axis A — interactions** (§3, per widget family).
**Axis B — viewport sizes** (the render must not break in any):
| size | px (w×h) | stresses |
|---|---|---|
| `narrow` | 320×720 | overflow, label wrap, horizontal scroll containment |
| `wide` | 1440×720 | stretching, max-width, alignment |
| `short` | 1024×320 | vertical clipping, tooltip/menu escaping the viewport |
| `tall` | 768×1400 | vertical fill, sticky/anchored elements |
| `default` | the renderer's natural size, **no width/height override** | must render + be interactive with zero layout props |

**Axis C — settings**: **default (no props override) MUST NOT break.** A widget with
only its required data and no optional styling/layout props must render and respond
to every interaction. Overrides are tested on top, never as a prerequisite.

A cell = (widget, interaction, size). The harness records `pass | fail | n/a` +
a screenshot + a one-line analysis per cell.

---

## 2. Cross-cutting interaction checks (apply to EVERY widget)

1. **Renders at all** — no blank box, no error boundary, no console error on mount.
2. **No layout overflow** — content stays inside its container; wide content
   (tables, charts, code) scrolls inside its own `overflow:auto` box, the page body
   never scrolls horizontally.
3. **Hover affordance** — anything interactive shows a hover state (cursor, bg, or
   highlight); nothing interactive is hover-dead.
4. **Focus ring** — keyboard focus is visible on every focusable control (a11y).
5. **No dead clicks** — a control that looks clickable does something or is visibly
   disabled (never a silent no-op).
6. **Recovers from no-data** — empty/loading/error data states render a placeholder,
   not a crash or a blank.

---

## 3. Per-family interaction checklist

### 3.1 Charts — `bar-chart`, `line-chart`, `scatter-chart`, `donut-chart`, `heatmap-chart`, `stacked-bar-chart`, `stacked-area-chart`
- **Hover a data point/segment → tooltip appears** with the correct value (the #1
  known failure). Tooltip must appear at every size and must not clip off-viewport
  at `short`.
- **Move between points → tooltip follows / updates**; leave the plot → tooltip hides.
- **Hover legend item → series highlight / de-emphasis** (if legend present).
- **Click legend item → toggle series** visibility (if supported).
- **Click a data point → emits its action/param** (if the widget writes a param).
- **Axis labels legible** — no overlap/clipping at `narrow`.
- **Empty series → placeholder**, not a blank canvas.

### 3.2 Selection inputs — `dropdown`, `checkbox-group`, `slider`, `color-input`, `datetime-input`
- **`dropdown`: click → menu opens** (the #2 known failure); options visible, not
  clipped; click option → selects + closes + updates param; click-away → closes;
  keyboard (↑/↓/Enter/Esc) works; menu escapes a `short` container instead of
  being clipped.
- **`checkbox-group`: click each box → toggles**; multi-select state correct.
- **`slider`: drag thumb → value updates live**; click track → jumps; keyboard
  arrows step; min/max clamp.
- **`color-input`: open picker → choose → value + swatch update**; close on away.
- **`datetime-input`: open calendar → pick date/time → value updates**; calendar
  not clipped at any size; close on away.

### 3.3 Text inputs — `text-input`, `text-area`, `number-input`
- **Focus → type → value updates**; placeholder shows when empty.
- **`number-input`: stepper buttons +/-**; min/max/step enforced; rejects non-numeric.
- **`text-area`: multiline + scroll** inside box.
- **Submit affordance** (Enter / blur) fires the param update.

### 3.4 Actions & containers — `button`, `form`, `tabs`, `div`, `sql-runner`
- **`button`: hover state, click → fires action**, disabled state visible + inert.
- **`form`: fill fields → submit → one batched action**; validation surfaces inline;
  reset works.
- **`tabs`: click each tab → switches panel**; active tab marked; keyboard nav;
  no panel content bleed; overflow tabs scroll at `narrow`.
- **`div`: children render + lay out** (flex/grid) at all sizes; nested interactions
  still work.
- **`sql-runner`: edit query → run → table updates**; error surfaces.

### 3.5 Data display — `sql-table`, `metric`, `text`, `html`, `image`, `video`, `iframe`
- **`sql-table`: sort by column header click**; horizontal scroll at `narrow`;
  pagination/row hover; cell tooltip if truncated.
- **`metric`: renders value + delta**; no overflow on long numbers.
- **`text`/`html`: renders markup**; links hover/click; no overflow.
- **`image`/`video`: loads + fits** (`max-width:100%`); `video` controls work;
  broken-src → placeholder.
- **`iframe`: loads** within bounds; no page-body scroll.

### 3.6 Maps — `map`, `fused-map`, `map-bounds`
- **Pan / zoom** (drag, scroll, +/- buttons); **hover feature → tooltip/popup**;
  **click feature → selection/param**; **`map-bounds`: move map → bounds param
  updates**; tiles load; resizes with container at all sizes.

### 3.7 Media inputs — `file-upload`, `camera-input`, `gallery-input`, `video-review`
- **`file-upload`: click → picker; drag-drop zone highlights on dragover; selecting
  a file → shows name + emits**.
- **`camera-input` / `gallery-input`: open → capture/select → preview + emit** (may
  be `n/a` in headless — record as skipped, not failed).
- **`video-review`: scrub timeline, add a marker/comment → emits**.

### 3.8 Composite control-plane widgets — `task-board`, `agent-detail`, `canvas`, `secrets-manager`
- **`task-board`: columns render; card hover; click card → opens; New-Task control;
  drag between columns** (if supported); refresh param.
- **`agent-detail`: renders agent; tabs/links work**.
- **`canvas`: nodes render; pan/zoom; node hover/click; comment overlay**.
- **`secrets-manager`: list renders; add/reveal/delete affordances** (mutations may
  be stubbed in audit — record).

---

## 4. Harness output

Per run the agent emits a structured report keyed by `(widget, size)`:
```
{ widget, size, interaction, result: "pass"|"fail"|"n/a", screenshot, note }
```
plus a roll-up: per-widget pass-rate, and a **failures-only** list (the fix backlog).
Failures carry the screenshot pair + the expected-vs-observed note so a fix can be
written without re-running the whole sweep. Silent skips (headless-only `n/a`) are
logged explicitly — never counted as passes.

---

## 4b. The harness (implemented)

The verifier lives at `scripts/widget-interaction-audit/` (driver `run.mjs` +
per-widget probes `interactions.mjs`, Playwright/Chromium) and renders against a
harness page hosted by a consuming control-plane app (now external — Flow, `fusedio/flow`:
`audit.html` → `src/audit/main.tsx`), which mounts the host's own `WidgetView` with STATIC
inline data (no resolve daemon) selected by `?widget=&variant=default|propped`. Fixtures
(one per component, default + propped) live in the host's `src/audit/fixtures.ts`. Run: start
that host's `vite` dev server, then `node scripts/widget-interaction-audit/run.mjs --base
http://localhost:<port> --sizes default,narrow,wide,short,tall`. It writes `report.json` +
before/after screenshots; `report.json` lists every cell's probe pass/fail for triage.

## 4c. First-run findings (all fixed)

A full sweep (38 widgets × 2 variants × 5 sizes = 380 cells) surfaced these REAL
bugs, all now fixed:

1. **line-chart / stacked-area-chart had no working tooltip** — `<Area>` was nested
   in `<LineChart>`; switched to `<ComposedChart>` (the user-reported "tooltip does
   not appear" bug).
2. **multi-series tooltip duplicated each series** ("North 45 North 45") — the Area +
   Line both entered the payload; deduped by name in the tooltip content.
3. **duplicate legend entry** per series — `legendType="none"` on the Area.
4. **chart tooltips were completely unstyled** (raw run-together text) — the
   `.ofw-chart-tooltip*` classes had no CSS; added the panel styling (fixes all 7
   charts at once).
5. **heatmap had only a slow native `title` tooltip** — added a custom hover tooltip
   for parity with the recharts charts.
6. **sql-table clipped horizontally at narrow widths** — the `DataTable` now scrolls
   both axes (`overflow-auto` + `w-max min-w-full`) instead of clipping.
7. **chart tooltip clipped at short viewport heights** — `allowEscapeViewBox={{x:false,
   y:true}}` on the cartesian tooltips.

After the fixes the sweep is clean across all 380 cells; the only residual note is
`video` / `video-review`, whose external sample-video URL is blocked in the offline
audit env (CORS) — both widgets degrade gracefully (player chrome renders), so this
is a harness-environment limitation, not a widget bug.

## 5. Authoring the demo project

The audit needs ONE project (`widget-gallery`) whose `widgets/` holds one config per
component type (§ catalog.md), each backed by minimal deterministic data (a tiny
in-repo parquet/inline rows) so the sweep is reproducible offline. Each widget is
authored **twice**: once with NO optional props (the default-must-not-break case,
Axis C) and once fully-propped. Data UDFs anchor assets via `OPENFUSED_PROJECT_ROOT`
(spec/backends/local.md) — never a relative `./` path.
