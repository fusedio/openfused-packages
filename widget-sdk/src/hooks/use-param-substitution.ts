/**
 * Reactively resolve `$param` and `{{udf}}` placeholders in a template.
 *
 * Pure-`$param` templates are handled in-SDK with a simple regex
 * substitution. Templates that reference `{{udf}}` (potentially with
 * `?overrides`, column/index access, or HTML template node recursion)
 * delegate to `bridge.template.render` so the host can use its rich UDF
 * machinery. The SDK orchestrates state, cancellation, and re-runs.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useCallback,
} from "react";

import { useFusedWidgetBridge } from "../bridge";
import { useFormParams } from "../form";
import type {
  ParamSubstitutionOptions,
  ParamSubstitutionResult,
} from "../types";
import { useCanvasParams } from "./use-canvas-params";

const PARAM_TOKEN_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
const UDF_PLACEHOLDER_RE = /\{\{[\s\S]*?\}\}/;
// Mirrors `parseInlineUdfPlaceholders` for the purpose of finding which UDF
// names a template references. We only need the leading identifier — full
// access-path / override parsing is the host's concern.
const UDF_NAME_EXTRACT_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;

/**
 * Reactively resolve `$param_name` and `{{udf_name}}` placeholders.
 *
 * - `$param_name` is substituted from canvas params (edge-filtered) and
 *   form-scoped values when inside a form.
 * - `{{udf_name}}` (and variants like `{{udf_name.col}}`, `{{udf_name?k=v}}`,
 *   HTML template node refs) is resolved by the host via the template bridge.
 *
 * Returns `{ value, loading }`. `loading` is `true` only while `{{udf}}`
 * data is being fetched; pure `$param` templates never trigger loading.
 *
 * @example — dynamic label
 * const { value } = useParamSubstitution("Selected region: $region");
 *
 * @example — SQL fragment with missing-param preservation
 * const { value: where } = useParamSubstitution(
 *   "WHERE city = '$city'",
 *   { preserveMissingParams: true }
 * );
 */
export function useParamSubstitution(
  template: string | undefined,
  options: ParamSubstitutionOptions = {},
): ParamSubstitutionResult {
  const safeTemplate = template ?? "";
  const preserveMissingParams = options.preserveMissingParams ?? false;
  const bridge = useFusedWidgetBridge();

  const paramNames = useMemo(
    () => extractParamNames(safeTemplate),
    [safeTemplate],
  );

  const canvasValues = useCanvasParams(paramNames);
  const { inForm, values: formValues } = useFormParams(paramNames);
  const paramValues = useMemo(
    () => (inForm ? { ...canvasValues, ...formValues } : canvasValues),
    [canvasValues, formValues, inForm],
  );

  const hasUdfRefs = useMemo(
    () => UDF_PLACEHOLDER_RE.test(safeTemplate),
    [safeTemplate],
  );

  // ── Fast path: no UDF refs ─────────────────────────────────────────────
  const pureParamValue = useMemo(() => {
    if (hasUdfRefs) return "";
    return substituteParams(safeTemplate, paramValues, preserveMissingParams);
  }, [safeTemplate, paramValues, preserveMissingParams, hasUdfRefs]);

  // ── Slow path: UDF refs ────────────────────────────────────────────────
  // Extract referenced UDF names so we can subscribe to their outputs.
  // When any of them re-executes we bump a tick and the effect below
  // re-runs `bridge.template.render` with fresh data.
  const referencedUdfNames = useMemo(() => {
    if (!hasUdfRefs) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    UDF_NAME_EXTRACT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UDF_NAME_EXTRACT_RE.exec(safeTemplate)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        out.push(m[1]);
      }
    }
    return out;
  }, [safeTemplate, hasUdfRefs]);

  // Subscribe to host re-render triggers (UDF outputs + topology) so that
  // the async render re-runs when an upstream UDF re-executes or edges shift.
  const templateChangeKey = useTemplateBridgeChangeKey(
    bridge,
    referencedUdfNames,
  );

  const [resolved, setResolved] = useState<{ key: string; value: string }>(
    () => ({ key: "", value: "" }),
  );
  const [loading, setLoading] = useState(false);

  // Render key includes template + paramValues + the host change ticker.
  const renderKey = useMemo(() => {
    return JSON.stringify({
      template: safeTemplate,
      paramValues,
      preserveMissingParams,
      tick: templateChangeKey,
    });
  }, [safeTemplate, paramValues, preserveMissingParams, templateChangeKey]);

  useEffect(() => {
    if (!hasUdfRefs) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    bridge.template
      .render(safeTemplate, paramValues, {
        preserveMissingParams,
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (cancelled) return;
          setResolved((prev) =>
            prev.key === renderKey && prev.value === result.value
              ? prev
              : { key: renderKey, value: result.value },
          );
          setLoading(result.loading);
        },
        (err: unknown) => {
          if (cancelled) return;
          if ((err as { name?: string })?.name === "AbortError") return;
          setLoading(false);
        },
      );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    bridge,
    hasUdfRefs,
    safeTemplate,
    paramValues,
    preserveMissingParams,
    renderKey,
  ]);

  const value = useMemo(() => {
    if (!hasUdfRefs) return pureParamValue;
    if (resolved.key === renderKey) return resolved.value;
    // Loading placeholder: ask host for best-effort sync render.
    try {
      return bridge.template.renderLoading(safeTemplate, paramValues, {
        preserveMissingParams,
      });
    } catch {
      return safeTemplate;
    }
  }, [
    bridge,
    hasUdfRefs,
    pureParamValue,
    resolved,
    renderKey,
    safeTemplate,
    paramValues,
    preserveMissingParams,
  ]);

  return { value, loading: hasUdfRefs ? loading : false };
}

function extractParamNames(template: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(PARAM_TOKEN_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function substituteParams(
  template: string,
  values: Record<string, unknown>,
  preserveMissingParams: boolean,
): string {
  return template.replace(PARAM_TOKEN_RE, (match, name: string) => {
    const v = values[name];
    if (v === undefined || v === null) {
      return preserveMissingParams ? match : "";
    }
    return stringifyParamValue(v);
  });
}

function stringifyParamValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const serialized = JSON.stringify(value);
  return serialized ?? "";
}

/**
 * Subscribe to the template bridge's change signal + every referenced UDF's
 * output via `bridge.udfs.subscribeOutput`. The returned numeric key
 * changes whenever a re-render could produce a different result.
 */
function useTemplateBridgeChangeKey(
  bridge: ReturnType<typeof useFusedWidgetBridge>,
  referencedUdfNames: readonly string[],
): number {
  const tickRef = useRef(0);
  const namesKey = referencedUdfNames.slice().sort().join("|");
  const subscribe = useCallback(
    (cb: () => void) => {
      const fire = () => {
        tickRef.current += 1;
        cb();
      };
      const unsubs: Array<() => void> = [bridge.template.subscribe(fire)];
      for (const name of referencedUdfNames) {
        unsubs.push(bridge.udfs.subscribeOutput(name, fire));
      }
      return () => unsubs.forEach((u) => u());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, namesKey],
  );
  const getSnapshot = useCallback(() => tickRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
