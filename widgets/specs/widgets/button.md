# `button`

> Action button. A press does either or both of: (1) run a UDF — set props.executor to a 'udf_name?key=value&key2=$param' string and the press runs that UDF once ($param binds against the live params, same substitution as SQL; the button shows a running state and disables mid-flight); (2) report a feedback action — set props.action and the press reports an action event by that name carrying the full param snapshot. Set submit: true on terminal feedback choices (e.g. Approve / Reject): a submit press settles the session and returns control to the waiting agent. A host embedding the renderer (e.g. the app's inbox) may provide an action sink that receives presses. A button with neither executor nor action is inert; on a surface with no UDF executor (deployed/MCP) an executor press is a visible no-op.

## Why
`button` is the OpenFused action primitive, with **two independent press channels** an author wires per the props set:
- **`executor` — run a UDF** (json-ui-app.md §11). The event-triggered write seam: the press runs a named UDF via the SDK's `useUdfExecutor`, with `$param` arguments bound against the live params at click time (the SAME substitution as SQL `{{ref}}`). This is how a button *acts* — promote, recompute, cancel — as opposed to merely signalling.
- **`action` — report feedback** (the human's reply channel in a feedback session). Its ROLE is feedback: the press reports an `action` event carrying the full current param snapshot to the waiting agent; it does NOT write the param store.

It is an **OpenFused-owned primitive**, NOT governed by app parity: the `{label, action?, executor?, submit?, variant?}` contract is fixed by `spec/ui/json-ui.md § Actions & selection` (it replaces the previous app-parity click-signal button), which is authoritative here. A "decision widget" is inputs + charts + one or more submit buttons.

## Expectation
- Renders the ui-kit `Button` (`@kit`) as `<button type="button">` with text `label` (falls back to `"Button"` when empty/falsy). The spec `variant` enum maps onto the kit's CVA variants: `"primary"` (and the unset default) → the kit `"default"` (prominent); `"secondary"` → the kit `"outline"` (quiet).
- **A press runs both channels (each independent, gated by its prop):**
  - **Executor (`executor` set):** `useUdfExecutor(props.executor)` from the SDK parses the `udf?k=$param` string, binds `$param` from the live params, and POSTs the resolved kwargs to the host udf-exec seam (`bridge.udfs.execute`). Fire-and-forget — the press does NOT wait on it to also report the action. While the UDF runs the button is **disabled** (`aria-busy`, no double-fire); an execution error is surfaced via the `title` attribute. On a surface with no executor (deployed-serve / MCP-Apps — `createStaticBridge` got no `execUrl`) `execute` resolves a structured error and the press is a visible no-op, mirroring the null-sink posture.
  - **Action (`action` set):** calls the handler from `ActionSinkContext`. A **host action sink** — installed above `RenderTree` by an embedding host (the app's inbox widget view, which wraps an action callback with the param-store snapshot) — wins; with no sink the standalone bundle installs the session or parley reporter (mutually exclusive on a page). With NO provider (`sink === null`) the action report is a no-op.
- A button with **neither** prop is inert (the press does nothing).
- **Submit vs non-submit press** (ignored once the button has already submitted):
  - non-submit (`submit` falsy) → reports the action with `terminal=false`, then a brief **pressed flash** (a transient focus ring) for **350 ms**; the session stays open and the agent sees an intermediate `action` event.
  - submit (`submit === true`) → reports the action with `terminal=true` and **locks into the submitted state only if the sink resolves `true`**: `disabled`, text becomes `✓ <label>`, and a muted, semibold confirmed appearance with a faint primary ring. On a session this is terminal (the session settles, the waiting agent receives this action name, the close beacon is disarmed). On a SINK page it locks only when the sink reports success. On a PARLEY page nothing ever settles — a submit press flashes ("Sent to the agent" toast) and the button STAYS USABLE (sink returns falsy → no lock).
- The action name sent is `action` when it is a string, else `""` (defensive coercion).
- `aria-pressed` is set to `true` while pressed or submitted, else `undefined`.
- **Guards / cleanup:** clicks are ignored once submitted; the pressed-flash timer is cleared on each new press and on unmount (`useEffect` cleanup). The submitted lock is one-shot.
- **writesParam is intentionally false** — the button broadcasts NOTHING to the param store.
- **Where it renders:** everywhere; no native-app-only restriction.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `label` | `string` | — | Button text. |
| `action` | `string` (optional) | — | Action name reported to the agent on press; the event carries the full current param snapshot. Omit for a pure UDF-trigger button. |
| `executor` | `string` (optional) | — | Run a UDF on press: `udf_name?key=value&key2=$param`. `$param` binds against the live params at click time (same substitution as SQL `{{ref}}`); the resolved kwargs are sent to the UDF. Fires once per press (not reactive). Omit for a non-executing button. |
| `submit` | `boolean` | `false` | If true, pressing is TERMINAL: settles the feedback session and the waiting agent receives this action name (use for final decisions). Default false = intermediate signal, session stays open. Applies to the `action` channel. |
| `variant` | `enum("primary","secondary")` | — (treated as `primary`) | Visual prominence: `"primary"` for the main decision, `"secondary"` for alternatives. |
| `style` | `string` | — | Optional inline CSS declaration string, parsed and merged over the component's defaults. |

- **Data-bound:** no.
- **Writes param:** no (`writesParam: false`; the button reports to the action/event channel, not the param store).

## Notes
- Visual leaf is the ui-kit `Button` (`@kit`); the transient pressed flash and terminal submitted lock layer on as state styling rather than dedicated classes.
- Executor seam: `useUdfExecutor` + `bridge.udfs.execute(udfName, overrides)` (`@fusedio/widget-sdk` ≥ 0.3.1) → the host's `POST /api/projects/:name/udf-exec` proxy → the resolve daemon's `/api/udf-exec` route, which **invokes the named UDF directly** on local compute with the overrides as typed kwargs and returns its raw value (`spec/json-ui-app.md §11`, ADR 0009 — not the synthesized-SQL/DuckDB path). The result is the UDF's actual return value in a `{data, error}` envelope; v1 is fire-and-forget — the button does not yet auto-refresh dependent queries from the result. `executor` is `writesParam: false`-neutral (it neither reads nor writes the param store; it only *reads* `$param` values to build the call).
- Channel plumbing: `ActionSinkContext` / `ActionSink = (action, terminal) → boolean | Promise<boolean>` (`spec/json-ui-inbox.md §4`). Session/parley routing lives in the standalone bundle's reporter wiring; see `spec/json-ui-local.md § Session events` and `§ The parley`.
- Part of the parley/feedback loop: a submit press is how `openfused widget open` unblocks and returns the chosen action name to the agent.
