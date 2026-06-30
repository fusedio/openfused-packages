// action-sink.tsx — the host action sink: the button's THIRD channel
// (spec/ui/json-ui.md §4).
//
// A host page that embeds the renderer natively (the app's inbox) provides a
// handler above `RenderTree` via this context (the app's WidgetView wraps its
// `onAction(action, params, terminal)` prop with the param store's snapshot
// and installs it here). A provided sink takes PRECEDENCE over both the
// session and the parley: the button routes every press to it and never
// touches the channel clients. The sink returns whether the press was
// accepted — a submit press locks into its submitted state only on `true`.
//
// Default null: with no provider the button falls through to the unchanged
// session/parley routing (and the MCP-Apps no-op posture when neither is
// active).

import React from "react";

/** Host press handler: `(action, terminal) → accepted` (sync or async). */
export type ActionSink = (
  action: string,
  terminal: boolean,
) => boolean | Promise<boolean>;

export const ActionSinkContext = React.createContext<ActionSink | null>(null);
