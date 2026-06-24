/**
 * The Fused workbench listens on this BroadcastChannel for parameter updates
 * from all components — both built-in and 3rd-party catalogs. The channel name
 * is part of the public protocol; do not change it without coordinating with
 * the workbench listener and all in-the-wild catalogs.
 */
export const PARAMETER_BROADCAST_CHANNEL = "parameter-updates";

/**
 * Discriminator for parameter messages on the BroadcastChannel.
 *
 * - `PARAM`    — generic parameter value update (the most common kind)
 * - `RANGE`    — range filter from a slider or histogram: `{ min, max }`
 * - `VIEWPORT` — map viewport bounds: `{ west, south, east, north }`
 * - `CLEAR`    — clear a parameter for this source (value will be `null`)
 */
export enum ParameterMessageType {
  PARAM = "param",
  RANGE = "range",
  VIEWPORT = "viewport",
  CLEAR = "clear",
}

/**
 * Canonical message shape posted on the parameter-updates BroadcastChannel.
 * All param messages — inbound and outbound — use this shape.
 *
 * The Fused workbench attaches additional source-identification fields
 * (`sourceUdfUniqueId`, `sourceUdfName`, `sourceTabId`) for edge-based
 * routing; catalog code does not need to construct these directly — use
 * the `bridge.params.set()` method (or the `useFusedParam` hook).
 */
export interface StandardMessage {
  type: ParameterMessageType;
  /** Canvas parameter name, e.g. `"selected_city"`. */
  parameter: string;
  /** Value payload; `null` for `CLEAR`. */
  values: unknown;
}

/** Type guard that verifies an unknown object is a valid StandardMessage. */
export function isStandardMessage(msg: unknown): msg is StandardMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    Object.values(ParameterMessageType).includes(
      m.type as ParameterMessageType,
    ) &&
    typeof m.parameter === "string" &&
    "values" in m
  );
}
