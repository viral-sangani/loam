"use client";

import { useCallback, useSyncExternalStore } from "react";

export type LibraryView = "room" | "list";

const KEY = "loam:library-view";
/** The choice made this session, for when storage is unavailable. */
let memo: LibraryView | null = null;

function readStored(): LibraryView | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "room" || v === "list" ? v : memo;
  } catch {
    return memo;
  }
}

let webgl2: boolean | null = null;
/** Whether this browser can draw the room at all. Checked once, and the test context released. */
export function hasWebGL2() {
  if (webgl2 !== null) return webgl2;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    webgl2 = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

const QUERIES = ["(max-width: 767px)", "(prefers-reduced-motion: reduce)"];

/** Why the list is the better default here, if it is: phones, reduced motion, Save-Data. */
function listPreferred() {
  if (QUERIES.some((q) => matchMedia(q).matches)) return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!conn?.saveData;
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  const mqs = QUERIES.map((q) => matchMedia(q));
  mqs.forEach((m) => m.addEventListener("change", fn));
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    mqs.forEach((m) => m.removeEventListener("change", fn));
    window.removeEventListener("storage", fn);
  };
}

function snapshot(): LibraryView {
  if (!hasWebGL2()) return "list";
  return readStored() ?? (listPreferred() ? "list" : "room");
}

/**
 * Room or List. The reader's own choice wins (stored in localStorage); otherwise phones, reduced
 * motion and Save-Data get the list. Without WebGL2 it is always the list.
 */
export function useLibraryView() {
  const view = useSyncExternalStore(subscribe, snapshot, () => "list" as LibraryView);
  const canRoom = useSyncExternalStore(subscribe, hasWebGL2, () => false);
  const setView = useCallback((v: LibraryView) => {
    memo = v;
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* private mode: the choice lasts until reload */
    }
    listeners.forEach((fn) => fn());
  }, []);
  return { view, setView, canRoom };
}
