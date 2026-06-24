import { useEffect, useState } from "react";

import { useFusedWidgetBridge } from "../bridge";

export type UploadAccessState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "allowed" }
  | { status: "denied"; message: string };

/**
 * Check whether the current user has write access to a destination path
 * (S3, GCS, etc.). Used by the `file-upload` widget to surface a clear
 * error before the user attempts to upload.
 *
 * Returns a state machine value `{ status: "idle" | "checking" | "allowed" |
 * "denied" }` that you can branch on directly in render.
 */
export function useUploadAccessCheck(
  destinationPath: string | undefined,
  enabled: boolean,
): UploadAccessState {
  const bridge = useFusedWidgetBridge();
  const [state, setState] = useState<UploadAccessState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !destinationPath?.trim()) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    bridge.uploads.checkAccess(destinationPath).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ status: "allowed" });
      } else {
        setState({
          status: "denied",
          message: result.message ?? "Upload access denied.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, destinationPath, enabled]);

  return state;
}
