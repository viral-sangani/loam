"use client";

import { useEffect, useState } from "react";

/** An anonymous request, scoped to the current route or book. */
export function usePublicLibrary<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string; data: T | null; error: string | null }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok && response.status !== 404) {
          throw new Error(response.status === 429 ? "The public library is busy. Try again later." : "The public library is unavailable right now.");
        }
        const data = response.ok ? await response.json() as T : null;
        if (!controller.signal.aborted) setResult({ path, data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ path, data: null, error: error instanceof Error ? error.message : "The public library is unavailable right now." });
        }
      }
    })();
    return () => controller.abort();
  }, [path]);
  return path && result?.path === path ? result : undefined;
}
