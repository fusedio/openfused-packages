import { useJsonUiNode } from "../bridge";

/**
 * Returns the identity of the current canvas node.
 *
 * `udfUniqueId` and `udfName` are used internally by `useFusedParam` for
 * edge-based param routing. Catalog components rarely need to read these
 * directly — they're surfaced primarily so logs and debugging can be
 * scoped to a node.
 *
 * Reads from `JsonUiNodeOverrideContext` first (so nested
 * `JsonUiConfigHashOverride` subtrees see their override), falling back to
 * the bridge's node identity.
 *
 * Returns `{ udfUniqueId: undefined, udfName: undefined, configHash: undefined }`
 * when the surrounding bridge has not populated them.
 *
 * @example
 * const { udfName } = useJsonUiUdfInfo();
 * console.log("I am node:", udfName);
 */
export function useJsonUiUdfInfo(): {
  udfUniqueId: string | undefined;
  udfName: string | undefined;
  configHash: string | undefined;
} {
  return useJsonUiNode();
}
