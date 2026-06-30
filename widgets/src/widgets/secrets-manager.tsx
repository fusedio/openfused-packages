// widgets/secrets-manager.tsx — a 1:1 replica of the app's Secrets page as a widget.
//
// Secret management (list / reveal-on-demand / add-update / delete) over the packaged
// _core.secrets-management UDFs (list / get / put / delete) — the upstream local
// encrypted store, shared by every project on the environment. Fully EXECUTOR-driven
// (no resolve-plane query): the widget fires bridge.udfs.execute for every read/write.
// Authored with the same ui-kit primitives + lucide icons the original SecretsPage used.

import { z } from "zod";
import React from "react";
import {
  useFusedWidgetBridge,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";
import { Button, Input, Check, Copy, Eye, EyeOff, KeyRound, Trash2 } from "@kit";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";

const LIST_REF = "_core.secrets-management.list";
const GET_REF = "_core.secrets-management.get";
const PUT_REF = "_core.secrets-management.put";
const DELETE_REF = "_core.secrets-management.delete";

function asStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

// The sanctioned in-UDF read path (spec/security/secrets.md, spec/runtime/sdk-openfused.md): the
// injected `openfused` module's `get_secret`. The copy button hands the user the
// exact expression to paste into a UDF, with the secret's own name filled in.
// `JSON.stringify` doubles as a Python string literal for the name (same quoting +
// backslash/quote escaping), so an exotic name stays a valid, safe argument.
export function accessSnippet(name: string): string {
  return `openfused.get_secret(${JSON.stringify(name)})`;
}

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export const secretsManagerProps = z.object({}).extend(UNIVERSAL_PROPS.shape);
type SecretsManagerProps = z.infer<typeof secretsManagerProps>;

function SecretsManager({ element }: ComponentRenderProps<SecretsManagerProps>) {
  const { style } = element.props;
  const bridge = useFusedWidgetBridge();

  const [names, setNames] = React.useState<string[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  // Bumped on every (re)load so SecretRow remounts — a revealed cleartext value must
  // not outlive an overwrite/delete (the original page remounted rows after saves).
  const [listRev, setListRev] = React.useState(0);

  const [formName, setFormName] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // (Re)load the secret names. The upstream `list` UDF returns a bare [{name}] list
  // (raw-return executor, ADR 0009); names only — values are revealed one at a time.
  const reload = React.useCallback(() => {
    setNames(null);
    setListError(null);
    void bridge.udfs.execute(LIST_REF, {}).then(({ data, error }) => {
      if (error) {
        setListError(error);
        setNames([]);
        return;
      }
      setNames(rowsOf(data).map((r) => asStr(r.name)));
      setListRev((n) => n + 1);
    });
  }, [bridge]);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const onSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const name = formName.trim();
    if (!name || !formValue.trim()) return;
    setSaving(true);
    setSaveError(null);
    const { error } = await bridge.udfs.execute(PUT_REF, { name, value: formValue });
    setSaving(false);
    if (error) {
      setSaveError(error);
      return;
    }
    setFormName("");
    setFormValue("");
    reload();
  };

  const onDelete = (name: string) => {
    void bridge.udfs.execute(DELETE_REF, { name }).then(({ error }) => {
      if (error) {
        setListError(error);
        return;
      }
      reload();
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 md:p-6" style={parseStyle(style)}>
      <div>
        <h1 className="text-lg font-semibold">Secrets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secrets are stored in the local encrypted store and shared by every project on this
          environment. Values are never pre-fetched — reveal one on demand.
        </p>
      </div>

      {/* Stored secrets */}
      <section className="space-y-1">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold">Stored secrets</h2>
          {names && names.length > 0 && (
            <span className="text-xs text-muted-foreground">{names.length}</span>
          )}
        </div>
        {listError && <p className="py-2 text-xs text-destructive">{listError}</p>}
        {names === null && <p className="py-2 text-sm text-muted-foreground">Loading…</p>}
        {names &&
          (names.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <KeyRound className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No secrets yet.</p>
              <p className="text-xs text-muted-foreground">
                Add one below — it becomes available to every project on this environment.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {names.map((name) => (
                <SecretRow
                  key={`${listRev}:${name}`}
                  name={name}
                  bridge={bridge}
                  onDelete={() => onDelete(name)}
                />
              ))}
            </div>
          ))}
      </section>

      {/* Add or update */}
      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-sm font-semibold">Add or update a secret</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Saving a name that already exists overwrites its value.
          </p>
        </div>
        <form className="space-y-4" onSubmit={(e) => void onSave(e)}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="secret-name">
              Name
            </label>
            <Input
              id="secret-name"
              placeholder="my-api-key"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="secret-value">
              Value
            </label>
            <Input
              id="secret-value"
              type="password"
              placeholder="••••••••"
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
            />
          </div>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!formName.trim() || !formValue.trim() || saving}>
              {saving ? "Saving…" : "Save secret"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

// SecretRow — name (mono) + reveal-on-demand (executor get) + a two-step delete
// confirm (the local store deletes immediately with no recovery, so guard the click).
function SecretRow({
  name,
  bridge,
  onDelete,
}: {
  name: string;
  bridge: ReturnType<typeof useFusedWidgetBridge>;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [value, setValue] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  // Copy the in-UDF access snippet (NOT the secret value — values reveal one at a
  // time). Falls back silently if the clipboard API is unavailable (insecure
  // context / denied permission): the button just doesn't flip to the check.
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(accessSnippet(name));
    } catch {
      return;
    }
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const handleReveal = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (value !== null) {
      setRevealed(true);
      return;
    }
    setLoading(true);
    setError(null);
    // `get` returns the {name, value} dict verbatim (raw-return executor).
    const { data, error: e } = await bridge.udfs.execute(GET_REF, { name });
    setLoading(false);
    if (e) {
      setError(e);
      return;
    }
    const row = rowsOf(data)[0] ?? (data as Record<string, unknown> | undefined);
    const v = row && "value" in row ? asStr((row as Record<string, unknown>).value) : null;
    if (v === null) {
      setError("not found");
      return;
    }
    setValue(v);
    setRevealed(true);
  };

  return (
    <div className="flex items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-medium">{name}</div>
        {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
        {revealed && value !== null && (
          <code className="mt-1 block select-all break-all font-mono text-xs text-muted-foreground">
            {value}
          </code>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <span className="text-xs text-muted-foreground">Delete permanently?</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? "Snippet copied" : "Copy access snippet"}
              title={copied ? "Copied!" : `Copy ${accessSnippet(name)}`}
              onClick={() => void handleCopy()}
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={revealed ? "Hide value" : "Reveal value"}
              title={revealed ? "Hide value" : "Reveal value"}
              onClick={() => void handleReveal()}
              disabled={loading}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete secret"
              title="Delete secret"
              onClick={() => setConfirming(true)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: SecretsManager,
    props: secretsManagerProps,
    description:
      "A 1:1 replica of the app's Secrets page as a widget: a secret manager (Stored secrets list with reveal-on-demand + two-step delete, and an Add/update form). Fully executor-driven over the packaged _core.secrets-management UDFs (list / get / put / delete) against the local encrypted store; values are never pre-fetched — revealed one at a time via the executor.",
    hasChildren: false,
  }),
  writesParam: false,
};

export default definition;
