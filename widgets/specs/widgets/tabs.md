# `tabs`

> Tabbed container: a label bar over one visible child panel; each child is the panel for the tab at the same index.

## Why
`tabs` is a layout primitive for composing tabbed surfaces from other components — e.g. an agent UI (Overview / Runs / Instructions) or any dashboard section set. The author reaches for it to fold several panels behind a single label bar, showing one at a time. It is a pure CONTAINER (display only, no data, no input): the `tabs` prop lists the labels and `element.children` are the panels in the SAME order (child 0 → tab 0); only the active panel renders, and tab state is local React state. It is OpenFused-owned (no Fused application equivalent), authored against the same primitives as the other containers (`div`/`form`).

## Expectation
- Renders a `role="tablist"` label bar (one `role="tab"` button per `tabs` entry, in order) over a single panel region; only `element.children[active]` renders. It is a `hasChildren: true` component.
- The active tab is local React state, seeded from `defaultTab` (0-based) clamped into the real tab range; clicking a tab sets it. The highlighted tab and the visible panel always share the same index.
- **Label/panel pairing:** labels come from the `tabs` prop; panels come from `element.children`. They pair by index. If there are fewer labels than panels, the extra panels are unreachable (author error); if there are more labels than panels, an orphan label selects the last panel rather than highlighting one tab while showing another's content (the shown index is `active` clamped to the panel range).
- Not data-bound: it has no `sql` prop, reads no result columns, and triggers no resolver query stamping. No loading or error state.
- Not an input: it broadcasts nothing to the param store (`writesParam: false`).
- The author's `style` string (universal prop) is parsed and applied as the outer element's inline `style`, merged over the component defaults.
- Renders everywhere (workspace, app, and the deployed self-contained bundle) — it needs no external resources.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `tabs` | `array<{label: string}>` (optional) | `[]` | The tab labels, in order. Each maps to the child panel at the same index (child 0 → tab 0). |
| `defaultTab` | `number` (optional) | `0` | Index of the tab shown first (0-based). |
| `style` | `string` (optional) | — | Inline CSS declaration string merged over the component's default styles. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`).

## Notes
- Authored only against `@fusedio/widget-sdk` (`defineComponent`, `ComponentRenderProps`, the style parser); children are collected via `React.Children.toArray(element.children)` and rendered as-is.
- Active tab is internal component state — it is not synced to a param, so it does not survive a remount and is not addressable from SQL.
- The tab bar uses plain Tailwind classes (a bordered underline for the active tab); no ui-kit primitives.
