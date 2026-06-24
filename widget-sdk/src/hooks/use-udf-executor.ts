/**
 * Event-triggered UDF execution.
 *
 * `useUdfExecutor` is the imperative sibling of `useParamSubstitution`: it
 * parses an `executor` string (`udf_name?key=value&key2=$param`), subscribes
 * to the canvas/form params its overrides reference, and returns a stable
 * `fire()` callback. Calling `fire()` resolves the overrides against the
 * *current* param values and runs the UDF once via `bridge.udfs.execute` —
 * nothing happens until the event fires.
 *
 * Any component can adopt it: wire `fire` to whatever event it owns (a button
 * click, a form submit, a row selection) and reflect `isRunning` / `error` in
 * its own UI.
 *
 * @example
 * function ButtonRenderer({ element }: ComponentRenderProps<{ executor?: string }>) {
 *   const exec = useUdfExecutor(element.props.executor);
 *   return (
 *     <button onClick={() => exec.fire()} disabled={exec.isRunning}>
 *       {exec.isRunning ? "Running…" : "Run"}
 *     </button>
 *   );
 * }
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { useFusedWidgetBridge, type UdfExecuteResult } from "../bridge";
import { useFormParams } from "../form";
import { parseExecutor } from "../utils/executor";
import {
  getDollarRefName,
  resolveOverrideValue,
} from "../utils/sql-placeholders";
import { useAllowedUdfNames } from "./use-allowed-udf-names";
import { useCanvasParams } from "./use-canvas-params";

export type UdfExecutorStatus = "idle" | "running" | "success" | "error";

export interface UseUdfExecutorOptions {
  /**
   * Output format forwarded to `bridge.udfs.execute`. Omit to let the host
   * pick its default (typically `"json"`).
   */
  format?: string;
}

export interface UseUdfExecutorResult {
  /**
   * Run the UDF. Optional `extraOverrides` are merged over the parsed
   * overrides and win — use them for runtime values not known at authoring
   * time (a clicked row id, a form's current field values). They are passed
   * through verbatim (no `$param` resolution). Resolves with the execution
   * result, or `null` when there is nothing to run.
   */
  fire: (
    extraOverrides?: Record<string, string>,
  ) => Promise<UdfExecuteResult | null>;
  /** Lifecycle of the most recent `fire()`. */
  status: UdfExecutorStatus;
  /** Convenience for `status === "running"`. */
  isRunning: boolean;
  /** Decoded output of the most recent successful run (`null` otherwise). */
  data: unknown;
  /** Error from the most recent run (invalid executor, edge gating, or execution). */
  error: string | null;
  /** Whether `executor` parsed to a runnable UDF reference. */
  canFire: boolean;
  /** Reset status / data / error back to idle and invalidate any in-flight run. */
  reset: () => void;
}

export function useUdfExecutor(
  executor: string | null | undefined,
  options: UseUdfExecutorOptions = {},
): UseUdfExecutorResult {
  const bridge = useFusedWidgetBridge();
  const { format } = options;

  const parsed = useMemo(() => parseExecutor(executor), [executor]);

  // The `$param` references inside override values — these are the canvas/form
  // params we subscribe to so `fire()` always resolves fresh values.
  const paramNames = useMemo(() => {
    if (!parsed) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rawValue of Object.values(parsed.overrides)) {
      const name = getDollarRefName(rawValue);
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }, [parsed]);

  // Mirror useParamSubstitution: form-scoped values shadow canvas values when
  // the component is rendered inside a form.
  const canvasValues = useCanvasParams(paramNames);
  const { inForm, values: formValues } = useFormParams(paramNames);
  const paramValues = useMemo(
    () => (inForm ? { ...canvasValues, ...formValues } : canvasValues),
    [canvasValues, formValues, inForm],
  );

  const allowedUdfNames = useAllowedUdfNames();

  // Keep resolution inputs in a ref so `fire` stays referentially stable and
  // always reads the latest values — it is event-driven, not reactive.
  const latest = useRef({ parsed, paramValues, allowedUdfNames, format });
  latest.current = { parsed, paramValues, allowedUdfNames, format };

  const [status, setStatus] = useState<UdfExecutorStatus>("idle");
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  // Monotonic run id: only the latest fire() may write state, so a slower
  // earlier run can't clobber a newer one (latest-wins).
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setStatus("idle");
    setData(null);
    setError(null);
  }, []);

  const fail = useCallback((message: string): UdfExecuteResult => {
    setStatus("error");
    setError(message);
    setData(null);
    return { data: null, error: message };
  }, []);

  const fire = useCallback(
    async (
      extraOverrides?: Record<string, string>,
    ): Promise<UdfExecuteResult | null> => {
      const {
        parsed: p,
        paramValues: pv,
        allowedUdfNames: allowed,
        format: fmt,
      } = latest.current;

      if (!p) {
        fail("No UDF to run (empty or invalid executor).");
        return null;
      }

      // Edge-gating parity with inline {{udf}} / SQL references: the UDF must
      // be reachable from this node. `null` means no filtering applies.
      if (allowed && !allowed.has(p.name)) {
        return fail(
          `UDF "${p.name}" is not reachable from this node — connect it with an edge.`,
        );
      }

      // Resolve `$param` references against current params; runtime
      // extraOverrides win over authored ones.
      const overrides: Record<string, string> = {};
      for (const [key, rawValue] of Object.entries(p.overrides)) {
        overrides[key] = resolveOverrideValue(rawValue, pv).value;
      }
      if (extraOverrides) Object.assign(overrides, extraOverrides);

      const runId = ++runIdRef.current;
      const isCurrent = () => runId === runIdRef.current;

      setStatus("running");
      setError(null);
      bridge.edges.startLoading();

      try {
        const result = await bridge.udfs.execute(p.name, overrides, {
          format: fmt,
        });
        if (isCurrent()) {
          if (result.error) {
            setStatus("error");
            setError(result.error);
            setData(null);
          } else {
            setStatus("success");
            setData(result.data);
            setError(null);
          }
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "UDF execution failed.";
        if (isCurrent()) {
          setStatus("error");
          setError(message);
          setData(null);
        }
        return { data: null, error: message };
      } finally {
        bridge.edges.stopLoading();
      }
    },
    [bridge, fail],
  );

  return {
    fire,
    status,
    isRunning: status === "running",
    data,
    error,
    canFire: parsed !== null,
    reset,
  };
}
