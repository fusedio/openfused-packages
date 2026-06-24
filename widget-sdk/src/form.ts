/**
 * Form-scoped parameter context.
 *
 * Provides a subscription store that mirrors live values of form fields
 * (slider, dropdown, text-input, …) so that sibling components inside the
 * same form can react to those values without ever broadcasting them to
 * the canvas. The submit action is the only event that leaks values out.
 *
 * Pure React — no Jotai, no workbench dependencies. The workbench's Form
 * component and the catalog-template test harness both call
 * `createFormParamsStore()` and provide it via `FormContext`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";

// ============================================================================
// Store
// ============================================================================

/**
 * Subscription-based store for form field values. Notifies only subscribers
 * watching the changed key so that slider dragging doesn't re-render every
 * sibling.
 */
export interface FormParamsStore {
  /** Read the current value for a single field name. */
  get: (name: string) => unknown;
  /** Read a snapshot containing only the requested names. */
  getSnapshot: (names: readonly string[]) => Record<string, unknown>;
  /** Read all field values (used by form submit). */
  getAll: () => Record<string, unknown>;
  /** Set a field value; notifies subscribers watching this name. */
  setField: (name: string, value: unknown) => void;
  /** Remove a field; notifies subscribers watching this name. */
  removeField: (name: string) => void;
  /** Subscribe to changes on any of the given names. Returns an unsubscribe fn. */
  subscribe: (names: readonly string[], cb: () => void) => () => void;
}

/** Create a fresh form params store. Called once per Form component instance. */
export function createFormParamsStore(): FormParamsStore {
  const values = new Map<string, unknown>();
  const subscribers = new Set<{ names: Set<string>; cb: () => void }>();

  const notify = (name: string) => {
    subscribers.forEach((sub) => {
      if (sub.names.has(name)) sub.cb();
    });
  };

  return {
    get(name) {
      return values.get(name);
    },
    getSnapshot(names) {
      const out: Record<string, unknown> = {};
      for (const name of names) {
        if (values.has(name)) out[name] = values.get(name);
      }
      return out;
    },
    getAll() {
      const out: Record<string, unknown> = {};
      values.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    },
    setField(name, value) {
      if (values.has(name) && Object.is(values.get(name), value)) return;
      values.set(name, value);
      notify(name);
    },
    removeField(name) {
      if (!values.has(name)) return;
      values.delete(name);
      notify(name);
    },
    subscribe(names, cb) {
      const sub = { names: new Set(names), cb };
      subscribers.add(sub);
      return () => {
        subscribers.delete(sub);
      };
    },
  };
}

// ============================================================================
// Context
// ============================================================================

export interface FormContextValue {
  /** Store holding the current field values for this form, or null when outside any form. */
  store: FormParamsStore | null;
  /** True when this subtree is rendered inside a Form component. */
  isInForm: boolean;
}

/**
 * Provides form-scoped values to all descendants. Provided by the workbench's
 * built-in Form component and by the catalog-template test harness.
 */
export const FormContext = createContext<FormContextValue>({
  store: null,
  isInForm: false,
});
FormContext.displayName = "JsonUiFormContext";

/** Read the form context — `{ store, isInForm }`. */
export function useFormContext(): FormContextValue {
  return useContext(FormContext);
}

// ============================================================================
// Hook: read form-scoped params
// ============================================================================

const EMPTY_PARAMS: Record<string, unknown> = Object.freeze({});

/**
 * Read live form-scoped values for the given param names.
 *
 * Returns `{ inForm: false, values: {} }` when used outside a form. Re-renders
 * only when one of the watched names actually changes — not on every field
 * update in the form.
 *
 * @example
 * const { inForm, values } = useFormParams(["city", "country"]);
 * if (inForm && values.city) console.log("city:", values.city);
 */
export function useFormParams(names: readonly string[]): {
  inForm: boolean;
  values: Record<string, unknown>;
} {
  const { store, isInForm } = useFormContext();

  const stableNames = useStableStringArray(names);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!store) return () => {};
      return store.subscribe(stableNames, cb);
    },
    [store, stableNames],
  );

  const snapshotRef = useRef<Record<string, unknown>>(EMPTY_PARAMS);
  const getSnapshot = useCallback(() => {
    if (!store) return EMPTY_PARAMS;
    const next = store.getSnapshot(stableNames);
    const prev = snapshotRef.current;
    if (shallowEqualRecords(prev, next)) return prev;
    snapshotRef.current = next;
    return next;
  }, [store, stableNames]);

  const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { inForm: isInForm, values };
}

function shallowEqualRecords(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/** Return a stable array reference when the string contents don't change. */
function useStableStringArray(names: readonly string[]): readonly string[] {
  const ref = useRef<readonly string[]>(names);
  const prev = ref.current;
  if (
    prev !== names &&
    (prev.length !== names.length || prev.some((n, i) => n !== names[i]))
  ) {
    ref.current = names;
  }
  return ref.current;
}
