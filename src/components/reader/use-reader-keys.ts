"use client";

import { useCallback, useEffect, useRef } from "react";
import { FONT_STEPS, step, type Panel } from "./config";
import type { EpubReader } from "./use-epub-reader";

/**
 * Keyboard shortcuts. Returns a handler for keys pressed inside the book frame,
 * whose listeners are passive, so it can't preventDefault there.
 */
export function useReaderKeys(
  reader: Pick<EpubReader, "next" | "prev" | "goChapter" | "updatePrefs" | "prefs">,
  togglePanel: (p: Panel) => void,
  closePanel: () => void,
  extra: Record<string, () => void> = {},
) {
  const { next, prev, goChapter, updatePrefs, prefs } = reader;
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const onKey = useCallback(
    (e: KeyboardEvent, fromBook: boolean) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") return closePanel();
      // Typing a note or a question in a panel mustn't turn pages or open panels.
      if (!fromBook && isTyping(e.target)) return;
      const p = prefsRef.current;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const bigger = () => updatePrefs({ fontSize: step(FONT_STEPS, p.fontSize, 1) });
      const actions: Record<string, () => void> = {
        ArrowRight: next,
        PageDown: next,
        ArrowLeft: prev,
        PageUp: prev,
        " ": e.shiftKey ? prev : next,
        "]": () => goChapter(1),
        "[": () => goChapter(-1),
        c: () => togglePanel("toc"),
        m: () => togglePanel("notebook"),
        q: () => togglePanel("ask"),
        r: () => togglePanel("recap"),
        p: () => updatePrefs({ showProgress: !p.showProgress }),
        "=": bigger,
        "+": bigger,
        "-": () => updatePrefs({ fontSize: step(FONT_STEPS, p.fontSize, -1) }),
        n: () => updatePrefs({ theme: p.theme === "light" ? "dark" : "light" }),
        "?": () => togglePanel("keys"),
        ...extra,
      };
      const action = actions[k];
      if (!action) return;
      if (!fromBook) e.preventDefault();
      action();
    },
    [next, prev, goChapter, updatePrefs, togglePanel, closePanel, extra],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onKey]);

  return useCallback((e: KeyboardEvent) => onKey(e, true), [onKey]);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
