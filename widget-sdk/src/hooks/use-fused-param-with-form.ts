import { useEffect } from "react";

import { useFormContext } from "../form";
import type { UseFusedParamOptions, UseFusedParamReturn } from "../types";
import { useFusedParam } from "./use-fused-param";

/**
 * Form-aware variant of {@link useFusedParam}.
 *
 * When the component is rendered inside a built-in Form, the field becomes
 * local state (its value is NOT broadcast to the canvas) and its live value is
 * mirrored into the form's subscription store, so sibling components (a
 * dropdown's SQL options, a chart, a text binding, …) can react to it before
 * the form is submitted. Outside a form it behaves exactly like
 * `useFusedParam` — two-way canvas binding with debounced broadcast.
 *
 * Requires a `FusedWidgetBridgeContext` ancestor (like `useFusedParam`) and a
 * `FormContext` ancestor for the in-form behavior (the built-in Form component
 * provides one).
 */
export function useFusedParamWithForm<T extends string | number>(
  options: UseFusedParamOptions<T>,
): UseFusedParamReturn<T> & { isInForm: boolean } {
  const formContext = useFormContext();
  const param = options.param;
  const isFormField = Boolean(formContext.isInForm && param);

  // Hook handles both cases: with param (canvas sync) or without (local state).
  // Disable canvas messaging when inside a form by withholding the param.
  const { value, setValue, broadcastNow, clearValue } = useFusedParam({
    ...options,
    param: isFormField ? undefined : options.param,
  });

  // Mirror the live value into the form's subscription store so sibling
  // components can react to it. Value updates use a dedicated effect so we
  // don't briefly remove the field from the store between renders —
  // unregistration runs only when the binding (store/param) actually changes
  // or on unmount.
  const store = formContext.store;
  useEffect(() => {
    if (!isFormField || !param || !store) return;
    store.setField(param, value);
  }, [value, isFormField, param, store]);

  useEffect(() => {
    if (!isFormField || !param || !store) return;
    return () => {
      store.removeField(param);
    };
  }, [isFormField, param, store]);

  return {
    value,
    setValue,
    broadcastNow,
    clearValue,
    isInForm: formContext.isInForm,
  };
}
