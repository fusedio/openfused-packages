import { useCallback, useEffect, useState } from "react";

import { useFusedWidgetBridge, type SignUrlResult } from "../bridge";
import { useParamSubstitution } from "./use-param-substitution";

/** URL schemes that require signing before fetch. */
export const SIGNED_URL_SCHEMES = ["s3://", "gs://", "fd://"] as const;

function needsSigning(url: string): boolean {
  return SIGNED_URL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/**
 * Manual URL signing — returns a stable `signUrl` callback you can call
 * with any URL. Useful when your component needs to sign URLs imperatively
 * (e.g. on user click). For reactive media src resolution, use `useMediaSrc`.
 *
 * @example
 * const { signUrl } = useUrlSigning();
 * const handleDownload = async () => {
 *   const { signed } = await signUrl("s3://my-bucket/file.csv");
 *   window.location.href = signed;
 * };
 */
export function useUrlSigning(): {
  signUrl: (url: string) => Promise<SignUrlResult>;
} {
  const bridge = useFusedWidgetBridge();
  const signUrl = useCallback((url: string) => bridge.signUrl(url), [bridge]);
  return { signUrl };
}

export interface UseMediaSrcResult {
  /** The resolved `src` URL (signed if needed, with `$param`s substituted). */
  src: string | null;
  /** True while substitution or signing is in flight. */
  loading: boolean;
  error: string | null;
  /** Re-sign — call to refresh an expired URL. */
  refreshSignedUrl: () => Promise<string | null>;
  /** The substituted source URL prior to signing (useful for diagnostics). */
  resolvedSrc: string;
  /** True if the resolved URL requires signing. */
  needsSigning: boolean;
}

/**
 * Reactively resolve a media `src` URL. Substitutes `$param` tokens first,
 * then signs S3/GCS/FD URLs. Other URL schemes pass through unchanged.
 *
 * @example
 * const { src, loading, error } = useMediaSrc(props.imageUrl);
 * if (loading) return <Spinner />;
 * if (error) return <div>Failed: {error}</div>;
 * return <img src={src ?? ""} alt="" />;
 */
export function useMediaSrc(srcInput: string | undefined): UseMediaSrcResult {
  const bridge = useFusedWidgetBridge();
  const { value: resolvedSrc, loading: paramLoading } =
    useParamSubstitution(srcInput);

  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (paramLoading) return;

    if (!resolvedSrc) {
      setDisplaySrc(null);
      setError(null);
      setSigning(false);
      return;
    }

    if (!needsSigning(resolvedSrc)) {
      setDisplaySrc(resolvedSrc);
      setError(null);
      setSigning(false);
      return;
    }

    let cancelled = false;
    setSigning(true);
    setError(null);

    bridge
      .signUrl(resolvedSrc)
      .then(({ signed }) => {
        if (cancelled) return;
        setDisplaySrc(signed ?? resolvedSrc);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load media");
        setDisplaySrc(null);
      })
      .finally(() => {
        if (!cancelled) setSigning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, paramLoading, resolvedSrc, refreshNonce]);

  const refreshSignedUrl = useCallback(async () => {
    if (!resolvedSrc || !needsSigning(resolvedSrc)) {
      return resolvedSrc ?? null;
    }
    const { signed } = await bridge.signUrl(resolvedSrc);
    const next = signed ?? resolvedSrc;
    setDisplaySrc(next);
    setError(null);
    setRefreshNonce((n) => n + 1);
    return next;
  }, [bridge, resolvedSrc]);

  return {
    src: displaySrc,
    loading: paramLoading || signing,
    error,
    refreshSignedUrl,
    resolvedSrc,
    needsSigning: Boolean(resolvedSrc && needsSigning(resolvedSrc)),
  };
}
