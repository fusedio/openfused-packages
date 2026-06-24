import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFusedWidgetBridge, useJsonUiNode } from "../bridge";
import { useFormParams } from "../form";
import { ParameterMessageType } from "../protocol";
import type { UseFusedParamOptions, UseFusedParamReturn } from "../types";

/**
 * Two-way bind a component to a named canvas parameter.
 *
 * When another node broadcasts a param value (e.g. a map click, a dropdown
 * selection from upstream), this hook receives it and updates `value`. When
 * the user interacts locally, `setValue()` debounces and broadcasts back so
 * connected UDF nodes re-run with the new value.
 *
 * Form integration: when this component is rendered inside a built-in Form,
 * the live form-field value shadows the canvas value so siblings react
 * before the form is submitted (form values are never broadcast to the
 * canvas until submit).
 *
 * Works as plain local state if `param` is undefined or empty.
 *
 * Requires: a `FusedWidgetBridgeContext.Provider` ancestor. The workbench's
 * `JsonUiProvider` provides one; tests use `createTestBridge()`.
 *
 * @example — number counter
 * const { value, setValue } = useFusedParam({ param: "count", defaultValue: 0 });
 * return <button onClick={() => setValue(value + 1)}>{value}</button>;
 *
 * @example — typed array param
 * const { value, setValue } = useFusedParam({
 *   param: "bounds",
 *   defaultValue: [-74, 40, -73, 41] as [number, number, number, number],
 *   validate: (v): v is [number, number, number, number] =>
 *     Array.isArray(v) && v.length === 4 && v.every(n => typeof n === "number"),
 * });
 *
 * @example — broadcast immediately on mouseup (bypass debounce)
 * const { setValue, broadcastNow } = useFusedParam({ param: "hue", defaultValue: 0 });
 * <input type="range" onChange={e => setValue(+e.target.value)} onMouseUp={broadcastNow} />
 *
 * @example — clear button
 * const { clearValue } = useFusedParam({ param: "selection", defaultValue: null });
 * <button onClick={() => clearValue(null)}>Reset</button>
 */
export function useFusedParam<T>({
  param,
  debounceMs = 300,
  readOnly = false,
  defaultValue,
  broadcastDefaultValue = true,
  validate,
  preprocess,
}: UseFusedParamOptions<T>): UseFusedParamReturn<T> {
  const bridge = useFusedWidgetBridge();
  const { configHash } = useJsonUiNode();
  const enabled = !!param;

  // Stable log helper — entries appear in the workbench's runtime logs panel.
  // configHash is passed through so nested JsonUiConfigHashOverride subtrees
  // tag entries correctly without requiring a bridge rebuild.
  const logPreview = (
    action: "Received" | "Broadcast" | "Cleared",
    raw: unknown,
  ) => {
    if (!param) return;
    if (action === "Cleared") {
      bridge.log.log(`Cleared param "${param}"`, "info", configHash);
      return;
    }
    const preview = JSON.stringify(raw);
    const trimmed =
      preview && preview.length > 100 ? preview.slice(0, 100) + "…" : preview;
    bridge.log.log(
      `${action} param "${param}" = ${trimmed}`,
      "info",
      configHash,
    );
  };

  // Stable validator and preprocessor. We deliberately omit `defaultValue`
  // from the deps so a parent re-render passing a new defaultValue literal
  // doesn't churn these. The type semantics only depend on the original.
  const preprocessor = useMemo(
    () => preprocess ?? createDefaultPreprocessor(defaultValue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preprocess],
  );
  const validator = useMemo(
    () => validate ?? createDefaultValidator(defaultValue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validate],
  );

  // Form-scoped value shadows canvas value when inside a form.
  const paramNamesForForm = useMemo(() => (param ? [param] : []), [param]);
  const { inForm, values: formParams } = useFormParams(paramNamesForForm);
  const formValue = param ? formParams[param] : undefined;

  // ── Initial value resolution ────────────────────────────────────────────
  // Read snapshot once to seed local state — subsequent updates come via the
  // sync effect below. Reading the bridge here is safe (synchronous).
  const initialCanvasValue = useMemo(() => {
    if (!enabled || !param) return undefined;
    return bridge.params.getSnapshot(param);
  }, [bridge, enabled, param]);

  const computeInitialValue = (): T => {
    const raw =
      inForm && formValue !== undefined ? formValue : initialCanvasValue;
    if (raw === undefined || raw === null) return defaultValue;
    const processed = preprocessor(raw);
    return validator(processed) ? processed : defaultValue;
  };

  const [value, setValueState] = useState<T>(computeInitialValue);
  const valueRef = useRef<T>(value);
  valueRef.current = value;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalChangeRef = useRef(false);
  const didBroadcastOnMountRef = useRef(false);

  // Stable closure over the latest binding for the unmount cleanup.
  // bridge is captured by ref too so the cleanup effect's deps can stay `[]`
  // — otherwise any bridge identity flip would re-run the effect and
  // broadcast a stray CLEAR for every bound input, cascading through the
  // canvas-param listener fan-out.
  const latestBindingRef = useRef({ enabled, param });
  latestBindingRef.current = { enabled, param };
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  // ── Clear bound param when name changes (carry-over avoidance) ──────────
  const prevParamRef = useRef(param);
  useEffect(() => {
    const prev = prevParamRef.current;
    prevParamRef.current = param;
    if (prev && prev !== param) {
      bridge.params.clear(prev);
    }
  }, [bridge, param]);

  // ── Subscribe to canvas (and form) updates ──────────────────────────────
  useEffect(() => {
    if (!enabled || !param) return;
    if (isLocalChangeRef.current) return;

    const raw =
      inForm && formValue !== undefined
        ? formValue
        : bridge.params.getSnapshot(param);

    // Do not reset to defaultValue on transient null/undefined — would wipe
    // the user's local selection during share-mode filtering or fast clicks.
    if (raw === undefined || raw === null) return;

    const processed = preprocessor(raw);
    if (processed !== valueRef.current && validator(processed)) {
      setValueState(processed);
      logPreview("Received", raw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, param, enabled, inForm, formValue, preprocessor, validator]);

  // Subscribe to bridge canvas updates so changes from other nodes flow in.
  useEffect(() => {
    if (!enabled || !param) return;
    const unsub = bridge.params.subscribe(param, () => {
      if (isLocalChangeRef.current) return;
      const raw = bridge.params.getSnapshot(param);
      if (raw === undefined || raw === null) return;
      const processed = preprocessor(raw);
      if (processed !== valueRef.current && validator(processed)) {
        setValueState(processed);
        logPreview("Received", raw);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, param, enabled, preprocessor, validator]);

  // ── Broadcast plumbing ──────────────────────────────────────────────────
  const broadcast = useCallback(
    (newValue: T) => {
      if (!enabled || !param) return;
      bridge.params.set(param, newValue, ParameterMessageType.PARAM);
      bridge.edges.stopLoading();
      logPreview("Broadcast", newValue);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, enabled, param],
  );

  const broadcastNow = useCallback(() => {
    if (!enabled || readOnly) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    bridge.edges.startLoading();
    broadcast(valueRef.current);
    isLocalChangeRef.current = false;
  }, [bridge, broadcast, enabled, readOnly]);

  const clearValue = useCallback(
    (newValue: T) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setValueState(newValue);
      valueRef.current = newValue;
      isLocalChangeRef.current = false;
      if (!enabled || !param || readOnly) return;
      bridge.params.clear(param);
      bridge.edges.stopLoading();
      logPreview("Cleared", null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, enabled, param, readOnly],
  );

  // Reset one-time mount broadcast guard when binding changes.
  useEffect(() => {
    didBroadcastOnMountRef.current = false;
  }, [param, enabled]);

  // Broadcast default value on mount when no canvas value exists.
  useEffect(() => {
    if (!enabled || !param || readOnly) return;
    if (!broadcastDefaultValue) return;
    if (didBroadcastOnMountRef.current) return;
    const canvasValue = bridge.params.getSnapshot(param);
    if (canvasValue !== undefined && canvasValue !== null) {
      didBroadcastOnMountRef.current = true;
      return;
    }
    // Empty-string defaults are noisy — skip.
    if ((valueRef.current as unknown) === "") {
      didBroadcastOnMountRef.current = true;
      return;
    }
    broadcast(valueRef.current);
    didBroadcastOnMountRef.current = true;
  }, [bridge, enabled, param, readOnly, broadcastDefaultValue, broadcast]);

  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue);
      if (!enabled || readOnly) return;
      isLocalChangeRef.current = true;
      bridge.edges.startLoading();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        broadcast(newValue);
        isLocalChangeRef.current = false;
      }, debounceMs);
    },
    [bridge, broadcast, debounceMs, enabled, readOnly],
  );

  // Cleanup: cancel pending debounce, and clear the bound param so preset
  // type-swaps don't leave stale canvas state behind. Deps are `[]` so this
  // runs on unmount only — never on bridge identity flips. bridge is read
  // from the ref at cleanup time.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const { enabled, param } = latestBindingRef.current;
      if (!enabled || !param) return;
      bridgeRef.current.params.clear(param);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { value, setValue, broadcastNow, clearValue };
}

// ============================================================================
// Default validator + preprocessor
// ============================================================================

function createDefaultValidator<T>(
  defaultValue: T,
): (value: unknown) => value is T {
  if (typeof defaultValue === "string") {
    return ((v: unknown): v is T => typeof v === "string") as (
      v: unknown,
    ) => v is T;
  }
  if (typeof defaultValue === "number") {
    return ((v: unknown): v is T => typeof v === "number") as (
      v: unknown,
    ) => v is T;
  }
  if (typeof defaultValue === "boolean") {
    return ((v: unknown): v is T => typeof v === "boolean") as (
      v: unknown,
    ) => v is T;
  }
  if (Array.isArray(defaultValue)) {
    return ((v: unknown): v is T => Array.isArray(v)) as (v: unknown) => v is T;
  }
  if (defaultValue !== null && typeof defaultValue === "object") {
    return ((v: unknown): v is T =>
      v !== null && typeof v === "object" && !Array.isArray(v)) as (
      v: unknown,
    ) => v is T;
  }
  return ((_v: unknown): _v is T => true) as (v: unknown) => v is T;
}

/**
 * Coerces raw canvas values to T before validation. For string T this
 * prevents the strict type guard from silently dropping numbers/booleans/
 * arrays/objects that arrive as the param value. For other types, passthrough.
 */
function createDefaultPreprocessor<T>(defaultValue: T): (v: unknown) => T {
  if (typeof defaultValue === "string") {
    return (v: unknown): T => {
      if (typeof v === "string") return v as T;
      if (Array.isArray(v)) return v.join(",") as T;
      if (v !== null && typeof v === "object") return JSON.stringify(v) as T;
      return String(v) as T;
    };
  }
  return (v: unknown): T => v as T;
}
