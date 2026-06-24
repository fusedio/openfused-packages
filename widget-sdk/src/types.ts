/**
 * The props every catalog component receives.
 *
 * The json-ui renderer calls your component as:
 * ```tsx
 * <MyComponent element={{ type: "my-type", props: { ...yourProps } }} />
 * ```
 *
 * Always destructure values from `element.props`; never spread `element` itself.
 *
 * @example
 * interface Props { param: string; label?: string; step?: number }
 * export function MyWidget({ element }: ComponentRenderProps<Props>) {
 *   const { param, label = "Value", step = 1 } = element.props;
 *   const { value, setValue } = useFusedParam({ param, defaultValue: 0 });
 *   return <button onClick={() => setValue(value + step)}>{label}: {value}</button>;
 * }
 */
export interface ComponentRenderProps<P = Record<string, unknown>> {
  element: {
    type: string;
    props: P;
    key?: string;
    children?: unknown[];
    visible?: boolean;
  };
}

// ============================================================================
// useFusedParam types
// ============================================================================

/**
 * Options for `useFusedParam`. The type parameter `T` is inferred from
 * `defaultValue` — pass typed defaults like `0`, `""`, `[] as Foo[]` to
 * narrow the return type.
 */
export interface UseFusedParamOptions<T> {
  /**
   * Canvas parameter name (kebab-case by convention).
   * If undefined or empty, the hook behaves as local state only (no broadcast).
   */
  param?: string;
  /** Debounce delay in ms between `setValue()` and the broadcast. Default: 300. */
  debounceMs?: number;
  /** Accept incoming canvas values but never broadcast outgoing ones. */
  readOnly?: boolean;
  /** Starting value. Type `T` is inferred from this. */
  defaultValue: T;
  /**
   * Broadcast `defaultValue` on mount if no canvas value exists. Default: true.
   * Empty-string defaults are never broadcast (guarded internally).
   */
  broadcastDefaultValue?: boolean;
  /** Custom type guard run on incoming values after `preprocess`. */
  validate?: (value: unknown) => value is T;
  /**
   * Coerce raw incoming values before validation. The default preprocessor
   * coerces strings to string; all other types pass through unchanged.
   */
  preprocess?: (value: unknown) => T;
}

/** Return value of `useFusedParam`. */
export interface UseFusedParamReturn<T> {
  /** Current value — updated from canvas, form, or local `setValue()`. */
  value: T;
  /** Set locally and broadcast to canvas (debounced). Starts edge animation. */
  setValue(newValue: T): void;
  /** Broadcast current value immediately, bypassing the debounce timer. */
  broadcastNow(): void;
  /** Reset to `newValue` locally and send a CLEAR message to the canvas. */
  clearValue(newValue: T): void;
}

// ============================================================================
// useParamSubstitution types
// ============================================================================

export interface ParamSubstitutionOptions {
  /**
   * If `true`, unresolved `$param` tokens are left as-is instead of being
   * replaced with empty string. Useful for SQL template fragments.
   */
  preserveMissingParams?: boolean;
}

export interface ParamSubstitutionResult {
  /** Template with all resolved tokens replaced. */
  value: string;
  /**
   * True while `{{udf_name}}` data is being fetched. Always `false` for
   * pure-`$param` templates.
   */
  loading: boolean;
}
