# `secrets-manager`

> A 1:1 replica of the app's Secrets page as a JSON-UI widget — a **Stored
> secrets** list (reveal-on-demand + two-step delete) and an **Add/update**
> form — backed by the packaged `_core.secrets-management` CRUD UDFs against the
> local encrypted store. OpenFused-owned; not governed by app parity.

## Why

Secret management is a first-class OpenFused concept with packaged `_core`
UDFs. Rendering the Secrets page as a widget lets the same surface be authored,
resolved, and edited through the executor seam instead of bespoke app REST —
consistent with `task-board` and `agent-detail`, and reusable wherever the
widget renderer runs (the app today). It carries no own props: the schema is
`z.object({})` extended only with `UNIVERSAL_PROPS`, so `style` is the only
authorable input.

## Where it renders

App-host surfaces only (the app's Secrets page). Like `task-board` /
`agent-detail`, every read/write rides the host's udf-exec proxy; the
deployed-serve bundle (no app host, no `_core` shared-workspace resolution) has
no executor and renders the unavailable/empty state.

## Data

Fully **executor-driven** — there is no resolve-plane (`{{ref}}`) query. The
widget fires `bridge.udfs.execute` for every read and write against the four
packaged `_core.secrets-management` UDFs (the upstream local encrypted store,
shared by every project on the environment):

- **List (`_core.secrets-management.list`)** — on mount (and after every
  write) returns a bare `[{name}]` list (raw-return executor, ADR 0009). Names
  only — values are never pre-fetched.
- **Reveal (`_core.secrets-management.get`)** — fired per-row, lazily, on the
  first reveal click; returns the `{name, value}` dict verbatim. One value is
  revealed at a time; a list (re)load bumps a revision so revealed rows remount
  and a cleartext value never outlives an overwrite/delete.
- **Save (`_core.secrets-management.put`)** — the Add/update form fires `put`
  with `{name, value}`; saving an existing name overwrites it. On success the
  form clears and the list reloads.
- **Delete (`_core.secrets-management.delete`)** — a two-step in-row confirm
  (the local store deletes immediately with no recovery, so the click is
  guarded) fires `delete` with `{name}`, then reloads.

## Exposed params

| prop | type | default | description |
|---|---|---|---|
| `style` | `string` (optional) | — | Inline CSS declaration string merged over the component's default styles. |

- **Data-bound:** no resolve-plane query — all data flows over the executor (`bridge.udfs.execute`).
- **Writes param:** no (`writesParam: false`).

## Notes

- Reveal-on-demand, never pre-fetch: the copy button hands the user the
  sanctioned in-UDF access snippet (`openfused.get_secret("<name>")`, see
  `spec/secrets.md` / `spec/sdk-openfused.md`), NOT the secret value; the
  clipboard write falls back silently in an insecure context.
- Authored with ui-kit (`@kit`) `Button`/`Input` primitives + lucide icons,
  matching the app's former `SecretsPage`; param binding is unused (the widget
  owns no param).
- `secrets-manager` is the third OpenFused-owned, executor-driven widget after
  `task-board` and `agent-detail`. See `widgets/agent-detail.md` (the sibling
  pattern), `spec/secrets.md` (the store contract), and `spec/json-ui/app.md`
  (the app render / executor host surface).
