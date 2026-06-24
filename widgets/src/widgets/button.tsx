// widgets/button.tsx — the ACTION button: the human's reply channel in a
// feedback session (spec/ui/json-ui.md § Actions & selection, json-ui-local.md
// § Session events).
//
// Prop contract (spec-owned, replaces the previous app-parity click-signal
// button): `{label, action?, executor?, submit?, variant?}`. A press does two
// independent things, either/both per the props set:
//   • `executor` (a `udf?key=$param` string) → runs that UDF once via the SDK's
//     `useUdfExecutor` (json-ui-app.md §11): `$param` binds against the live
//     params (the SAME substitution as SQL `{{ref}}`) and the resolved kwargs
//     POST to the host udf-exec seam. The button shows a running state and
//     disables mid-flight; on a read-only surface the press is a visible no-op.
//   • `action` → reports an `action` event named `props.action` — with the full
//     current param snapshot — to the page's session via `reportAction`
//     (../session). A button with neither prop is inert. `submit: true` makes
// the press TERMINAL: the session settles and the blocked `openfused widget
// open` returns with that action name. Outside a session (the MCP-Apps path,
// un-sessioned local page loads) the button renders enabled but a press is a
// no-op — `reportAction` returns false and no visual state changes.
//
// The press routes to whichever channel is active. A HOST ACTION SINK
// (../action-sink, json-ui-inbox.md §4) — provided via context by a host page
// embedding the renderer (the app's inbox) — wins over everything; with no
// sink it is the session first, else the parley (json-ui-local.md § The
// parley; those two are mutually exclusive on a page). On a PARLEY page
// nothing ever settles: a submit press shows the press flash (parley.ts adds
// the transient "Sent to the agent" toast) and the button STAYS USABLE — the
// conversation continues and the agent will likely push a next view. On a
// SINK page a submit press locks only when the sink reports success.
//
// Behaviour (session):
//   • non-submit press → brief pressed flash (ofw-btn--pressed, ~350 ms); the
//     session stays open, the agent sees an intermediate `action` event.
//   • submit press     → one-shot: the button locks into a disabled
//     "✓ <label>" submitted state (ofw-btn--submitted); session.ts stops the
//     params reporter and disarms the close beacon once the server accepts it.
//   • writesParam is intentionally ABSENT/false: the button writes NOTHING to
//     the param store (actions ride the event channel, not params).
//
// NOTE on app parity: unlike the other components (strict paste-compatible
// subsets of the Fused application's), `button` is openfused's feedback
// primitive — the action/submit semantics are fixed by spec/ui/json-ui.md
// § Actions & selection, which is authoritative over app parity here.

import React from "react";
import { z } from "zod";
import {
  parseStyle,
  defineComponent,
  useUdfExecutor,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Button as KitButton } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { ActionSinkContext } from "../action-sink";

// ----------------------------------------------------------------- props schema
// Spec-fixed contract: label + action required; submit defaults false; variant
// is a two-value enum (primary = prominent amber, secondary = quiet panel).
export const buttonProps = z
  .object({
    label: z.string().describe("Button text."),
    action: z
      .string()
      .optional()
      .describe(
        "Action name reported to the agent/host when the button is pressed (the event carries the full current param snapshot). OPTIONAL — omit for a pure UDF-trigger button (set `executor` instead). A button with neither `action` nor `executor` is inert.",
      ),
    executor: z
      .string()
      .optional()
      .describe(
        "Run a UDF when the button is pressed: `udf_name?key=value&key2=$param`. `$param` values bind against the live params at click time (the SAME substitution as SQL `{{ref}}`); already-resolved kwargs are sent to the UDF. The press fires the UDF once (it does not re-resolve reactively). The button shows a running state while it executes and disables to prevent a double-fire.",
      ),
    submit: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "If true, pressing is TERMINAL: it settles the feedback session and the waiting agent receives this action name. Use for final decisions (Approve / Reject / Done). Default false (intermediate signal; the session stays open).",
      ),
    variant: z
      .enum(["primary", "secondary"])
      .optional()
      .describe(
        'Visual prominence: "primary" (default) for the main decision, "secondary" for alternatives.',
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type ButtonProps = z.infer<typeof buttonProps>;

const PRESSED_FLASH_MS = 350;

// -------------------------------------------------------------------- component
function Button({ element }: ComponentRenderProps<ButtonProps>) {
  const { label, action, executor, submit, variant, style } = element.props;
  const sink = React.useContext(ActionSinkContext);
  // Event-triggered UDF execution (the `executor` prop). With no executor the
  // hook is inert (`canFire` false, `fire` a no-op); on a read-only surface its
  // `fire` resolves to a structured error the hook surfaces as `error`.
  const exec = useUdfExecutor(executor);

  // One-shot submitted lock (submit buttons) + brief pressed flash (others).
  const [submitted, setSubmitted] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  const isSubmit = submit === true;

  const handleClick = () => {
    if (submitted) return;

    // (1) Run the UDF, if an `executor` is set. Fire-and-forget — the button
    // reflects `isRunning`/`error` from the hook (it does not block the action
    // report below). The hook resolves `$param` against the live params and
    // POSTs the already-resolved kwargs to the host udf-exec seam.
    if (exec.canFire) void exec.fire();

    // (2) Report the feedback action, if an `action` name is set AND a host
    // channel is present (spec/json-ui-inbox.md §4: the embedding host installs
    // one above `RenderTree` via `ActionSinkContext` — the app's WidgetView, or
    // the standalone bundle's session/parley reporters). A submit press locks
    // only when the sink reports success; non-submit presses flash.
    const name = typeof action === "string" ? action : "";
    if (name && sink !== null) {
      if (isSubmit) {
        void Promise.resolve(sink(name, true)).then((ok) => {
          if (ok) setSubmitted(true);
        });
        return; // terminal press — no flash
      }
      void sink(name, false);
    }

    // (3) Brief pressed flash for any non-terminal press that actually did
    // something (ran a UDF and/or reported an action).
    if (name || exec.canFire) {
      setPressed(true);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setPressed(false), PRESSED_FLASH_MS);
    }
  };

  const text = label || "Button";
  const running = exec.isRunning;

  // Visual leaf adopts the ui-kit Button (§6.2): the spec-owned prominence enum
  // maps onto the kit's CVA variants — "primary" → the prominent default,
  // "secondary" → the quiet outline. The transient pressed flash and the
  // terminal submitted lock layer on as Tailwind state classes (the
  // accent-tinted ring / muted lock the old ofw-btn--pressed/--submitted gave).
  const kitVariant = variant === "secondary" ? "outline" : "default";
  const stateClasses = submitted
    ? "ring-1 ring-primary/40 bg-muted text-muted-foreground font-semibold"
    : pressed
      ? "ring-2 ring-ring/60"
      : "";

  return (
    <KitButton
      type="button"
      variant={kitVariant}
      className={stateClasses}
      // Disable on the terminal submitted lock AND while a UDF is in flight, so
      // a press can't double-fire the executor. `title` surfaces an exec error.
      disabled={submitted || running}
      title={exec.error ?? undefined}
      style={parseStyle(style)}
      onClick={handleClick}
      aria-pressed={pressed || submitted || undefined}
      aria-busy={running || undefined}
    >
      {submitted ? `✓ ${text}` : text}
    </KitButton>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: Button,
    props: buttonProps,
    description:
      "Action button. A press does either or both of: (1) run a UDF — set props.executor to a 'udf_name?key=value&key2=$param' string and the press runs that UDF once ($param binds against the live params, same substitution as SQL; the button shows a running state and disables mid-flight); (2) report a feedback action — set props.action and the press reports an action event by that name carrying the full param snapshot. Set submit: true on terminal feedback choices (e.g. Approve / Reject): a submit press settles the session and returns control to the waiting agent. A host embedding the renderer (e.g. the app's inbox) may provide an action sink that receives presses. A button with neither executor nor action is inert; on a surface with no UDF executor (deployed/MCP) an executor press is a visible no-op.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
