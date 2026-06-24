# `@fusedio/widgets` — the comment-overlay rendering surface

The **rendered overlay** that pins Figma-style comment threads onto widgets. This is the
package half — pins, threads, anchoring, the param binding the renderer consumes. The
behavioural/logic half — the `__comments` param-plane persistence semantics, the agent
feedback loop, and normalization-as-contract — stays in the host spec
[`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md). The split is
load-bearing: **this file describes what is drawn; the host file describes what it means.**

A comment is **just a page-level param** (`__comments`), so the overlay carries no transport
of its own — it reads/writes one reactive param and the bridge fans the change out to the
parley (→ agent) and URL-sync (→ human). See
[`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md) §1, §4.

---

## 1. Two overlays, one param

The renderable surface is **two sibling overlays** that read the **one** `__comments` param
and each render only the subset whose anchor kind it owns:

| Overlay | Anchors owned | Pin coordinate space |
|---|---|---|
| **Canvas overlay** | `canvas-node` (`anchorId`) + `free` (`x`/`y`) | flow coords (pans/zooms with the canvas) |
| **Page layer** (`CommentsLayer`) | `widget-node` (`anchorPath`) | document coords (live `getBoundingClientRect`) |

Both share the thread popover, pin glyph, relative-time formatter, id generator, and the
right-edge-flip behaviour, plus the pure data ops and the param hook. Only **where a pin is
positioned** differs, so that logic lives in each overlay; everything visual + the
close/track behaviour is shared.

> **Canvas vs page separation (PINNED).** The page layer's click hit-test bails on any node
> inside a canvas surface so the canvas keeps its flow-coordinate anchoring; the canvas's own
> nodes still carry `data-ofw-node` (they render through the same `RenderNode`) but the page
> layer never claims them. A canvas page uses the canvas overlay; any non-`canvas` root uses
> the page layer.

---

## 2. UI surface (chrome is FREE)

Three pieces + a mode, identical across both overlays:

- **Comment mode** — a toggle (canvas: a button in the canvas controls cluster; page:
  a floating bottom-right FAB unless `hideToggle`) plus the `C` key (`Esc` exits; both
  ignored while typing in an input/textarea/contentEditable). While active a click on a
  target opens an auto-focused inline **draft** input at the click point; the body cursor is
  `crosshair` (page layer).
- **Pin** — a small button marker, constant screen size. Open vs resolved are visually
  distinct, and the currently-open thread's pin is highlighted. The pin glyph shows `✓` when
  resolved, else the reply count (or empty). The canvas overlay also renders a **hover preview
  card** after a short hover delay (220 ms); the page layer has no hovercard. Clicking a pin
  **only toggles** its thread popover — viewing never commits, so it never starts the feedback
  loop.
- **Thread popover** (`CommentThreadPopover`) — screen-space, portaled to `document.body`,
  `role="dialog"`: the root message + replies, a reply input (hidden once resolved), an edit
  affordance on each message authored by the human, and **Resolve / Reopen / Delete** actions.

Every mutation calls a pure op then `commit` — see §5.

### Placement rules (PINNED — each encodes a shipped fix)

- **The popover hugs its pin.** Its bottom clamp uses the **measured** rendered height
  (`useLayoutEffect` re-measures as replies/edit mode change it), never a fixed max — clamping
  by the max parked short threads far above any pin in the lower half of the window.
- **Right-edge flip for every floating card.** The popover, the hover preview, and the draft
  input each render to the **left** of their anchor (using its width plus a small gap) when
  they would overflow the right edge — the draft and hovercard share one right-edge overflow
  check. Widgets often live in narrow iframes.
- **The popover tracks its pin** through pan/zoom/scroll: position is recomputed every render
  as a pin-relative offset (canvas: from the live ReactFlow `transform` via `useStore`; page:
  from the node's live rect, re-tracked on a `scroll`/`resize` listener + `ResizeObserver`).
- **Click-vs-drag dismissal.** A *click* outside the popover closes it; a *drag* (pan/select,
  movement > 4 px between pointerdown/up) does **not** — so panning while a thread is open keeps
  it open and tracking.
- **No blocking capture div.** Comment placement runs through a **capture-phase** document
  `click` listener (page layer) / ReactFlow `onPaneClick`/`onNodeClick` (canvas), so
  wheel/two-finger-scroll passes straight through to the page while a left-click still places
  a comment; the handler `stopPropagation`/`preventDefault`s only when it consumed the click,
  keeping the widget underneath from activating.

Behavioural rules (PINNED): a click that opens a comment does not also pan/select the canvas;
comment mode does **not** require `editable` (comments are an overlay, not structural
editing). Everything visual (pin shape, popover styling, animation) is **FREE**, subject to
the canvas design rules in [`./canvas.md`](./canvas.md) (solid cards, glass for floating
chrome only, reduced-motion honored).

---

## 3. The anchor model

`CanvasComment` carries exactly **one** anchor kind (validated by a zod schema; the
data-model contract is host-side,
[`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md) §2):

| Anchor kind | Fields | Resolved by | Coordinate space |
|---|---|---|---|
| **canvas-node** | `anchorId` (+ `offsetX/Y`) | canvas overlay | flow coords (pans/zooms) |
| **widget-node** | `anchorPath` (+ `offsetX/Y`) | page-level `CommentsLayer` | document coords |
| **free** | `x`/`y` | the layer that owns the comment | (its layer's space) |

- **`anchorId`** is a canvas node id (`props.nodes[].id`) — author-defined and stable, so it
  round-trips unchanged. If it names a node not in the current canvas, the comment degrades to
  its `x`/`y` (a pure op drops the anchor; it never disappears). A pin whose node is a
  **collapsed folder member** is hidden (the thread stays in `__comments`, returns on expand)
  and an open popover/hovercard for it closes.
- **`anchorPath`** is a stable, deterministic **pre-order path** through the config tree
  (e.g. `"0.2.1"` = root → 3rd child → 2nd child) — the same addressing precedent as the
  planner's `_queryId`. `RenderNode` stamps every node with `data-ofw-node="<path>"` on a
  layout-neutral wrapper (zero layout impact). The page layer finds a node by
  `document.querySelector('[data-ofw-node="<path>"]')` and, because the marker has no box of
  its own, derives its on-screen box from the **union of its children's rects**. `offsetX/Y`
  are px from the box top-left, clamped to the box.

> **Generalized "comment on ANY widget" (Pass-2, additive).** `anchorPath` is the lift that
> makes a comment pin to any widget node, not just a canvas node — with **no backend or
> transport change** (the param plane was already widget-agnostic). On a comment-mode click
> the page layer hit-tests the topmost `[data-ofw-node]` under the pointer via
> `elementsFromPoint` (skipping its own overlay nodes), opening a draft anchored to that
> node's path + offset.

> **Graceful degradation.** An `anchorPath` is stable across re-renders of the *same* config.
> An agent push that restructures the tree can orphan a path — an unresolved `anchorPath` (or
> a node currently off-screen / `visibility:hidden`, e.g. an inactive tabs panel) is simply
> **not rendered**; the comment still lives in `__comments`, so the agent still sees it and
> can re-target or resolve it. Same "anchor gone → don't lose the comment" rule as
> canvas-node anchors.

**Non-goals (Pass-2):** sub-element anchoring (a table cell, a chart bar) needs intra-widget
addressing widgets don't expose — v1 anchors to a whole **widget node** box; and page
comments require a node target (no free-floating page comments — the canvas keeps free
`x`/`y`).

---

## 4. The seed prop and the `__comments` binding

The renderer consumes comments through one hook, `useCanvasComments(seed)`, which binds the
array to the reserved page-level param `__comments` via `useFusedParam`. Reads are normalized;
the hook returns `{ comments, commit }`.

- **`props.comments`** is the durable **seed** an agent bakes into a config. It is harvested
  into the `__comments` param **before** the parley/URL reporters attach, so seeding fires no
  spurious `params` event. The harvest walk (`harvestInitialParams`) is pre-order,
  first-seen-wins, and accepts either `props.comments` (canonical) or `props.__comments` (the
  live param key, so an agent that baked comments back under the param key re-seeds correctly).
  A config without comments harvests **no** `__comments` key.
- `useCanvasComments` does not broadcast a mount-time default value (the store is already
  seeded by the harvest, so it would be a redundant/spurious params event) and commits without
  debounce (each commit is a discrete structural change, not free-text typing).
- **`mergeLiveComments(prevLive, configSeed)`** is the client forward-merge applied on an
  agent **push**: the page reseeds `__comments` from the pushed
  config's seed, but a comment the human added since the last push lives only in the live
  param and would be clobbered. The merge keys by `id`: a config-seed id wins (the agent is
  the authoritative writer for ids it knows — its resolved/`in_progress` state + appended
  replies survive); a **live-only** id is kept (the human comment the push didn't carry).
  Returns `undefined` when both sides are empty so the "no comments → no `__comments` key"
  property holds. A human **delete** is already absent from the live side, so it is not
  resurrected.

The full persistence contract — URL-sync (human durability) vs config-reseed (agent
durability), the resolved-first URL soft-cap, why a comment change re-resolves nothing
server-side — is host-side
([`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md) §4).

---

## 5. Commit + the feedback-write gate (client behaviour)

Every mutation flows through `commit(next)`, which normalizes + sorts and writes the param.
The pure ops it calls are immutable + deterministic (ids and timestamps are passed in by the
overlay, never generated inside the op): add a comment, edit a message's content, add a reply,
resolve, reopen, delete, and re-anchor a comment. Normalization runs on every read **and**
before every write, so junk never round-trips (blank-content threads/replies dropped, missing
`status` → `"open"`, malformed → `[]`, `in_progress` preserved).

The page layer's `CommentsLayer` wraps `commit` to drive the host feedback loop:

- **`feedbackMode` + `onComment`** — in feedback mode, each *new* comment in `next` fires
  `onComment({ text, anchorId?, anchorPath? })` so the host can tell the agent which widget
  the feedback targets and buffer the batch.
- **`onRequestCommentMode`** — when the host owns the on/off, a *feedback WRITE* auto-starts
  the loop. A feedback write is true for exactly three writes — a **new** comment, a **reopen**
  (`resolved` → not), or a **new reply** — and deliberately false for edit / resolve / delete /
  drag-reposition and for merely **viewing** a thread (which doesn't commit).
- **`onCommentsChange`** — fired with the **full** array on every commit (distinct from the
  new-only `onComment`); the host debounces it to persist comments back into the config JSON.

The agent-side reading of this data (open = work queue; `anchorId`/`anchorPath` = scope
pointer; resolve by pushing a config whose `props.comments` is the full updated array) is the
host feedback loop, [`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md)
§5 — the overlay surfaces it, it does not own it.

---

## 6. Enablement

The overlay is on by default; three switches turn it off, at three layers:

| Switch | Where | Effect |
|---|---|---|
| `props.enableComments: false` | the config (canvas root, or a non-canvas root) | hides the toggle and all pins/threads for that view (default `true`) |
| `commentsDisabled` (canvas) / `disableComments` (host) | the host (`CanvasHostContext` / the app's `WidgetView`) | forces the whole overlay off regardless of `enableComments` — e.g. the Work Products view |
| `hideToggle` (page layer prop) | the host | hides the floating FAB only (the app drives mode from its own "Feedback mode" header button + the `C` key); pins/threads still render |

- **Canvas:** `CanvasRenderer` enables comments only when `enableComments` is not `false`
  **and** the host has not set `commentsDisabled`, mounting the canvas overlay / the controls
  toggle only then.
- **Page:** a consumer mounts `CommentsLayer` for any **non-`canvas`** root, gated the same
  way (root not a `canvas`, `enableComments` not `false`, host `disableComments` not set); the
  app's `WidgetView` is the reference consumer — `WidgetView` itself lives in the **app** (a
  consumer), not this package.
- The standalone MCP bundle mounts `CommentsLayer` with no `onRequestCommentMode`, keeping the
  **local** toggle behaviour.

`CommentsLayer` mounts **inside** the bridge provider (so `useCanvasComments` →
`useFusedParam` works) as a page-level sibling of the rendered tree — the optional `children`
slot of `RenderTree` ([`./rendering.md`](./rendering.md)) — but portals its visual surface to
`<body>` for clip-free fixed positioning.

---

## Cross-references

- [`./canvas.md`](./canvas.md) — the canvas rendering surface (flow-coord pins live on it;
  the controls cluster hosts the canvas comment toggle; the canvas design rules the chrome
  obeys).
- [`./rendering.md`](./rendering.md) — `RenderNode` (`data-ofw-node` path stamping), the
  `{element}` contract, and `RenderTree`'s page-level `children` slot the page layer mounts into.
- [`./surfaces.md`](./surfaces.md) — the package exports (`CommentsLayer`, the canvas overlay,
  `harvestInitialParams` / `mergeLiveComments` on `@fusedio/widgets/data-store`).
- **Host (logic half):** [`../../../spec/json-ui-comments.md`](../../../spec/json-ui-comments.md)
  — the `__comments` param-plane persistence (URL-sync vs config-reseed, the URL soft-cap),
  the data model + normalization-as-contract, and the agent feedback loop.
- **Host (app render/resolve):** the consuming control-plane app's comment wiring +
  feedback-task lifecycle now lives in fusedio/flow.
