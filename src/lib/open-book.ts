"use client";

import { loadBookFile } from "./library";

/**
 * Opening a book fast. The library already knows where each book's file is and where the reader
 * left off, so it hands that over when a book is opened. The reader can then fetch the file and
 * lay out the page while sign-in and its own queries are still on the way.
 */

export type Handoff = { epub: string; epubUrl: string; cfi: string };

const key = (id: string) => `loam:open:${id}`;
const files = new Map<string, Promise<ArrayBuffer>>();

/** Start loading the reader's code and this book's file, so a later open is instant. */
export function warmBook(epub: string, epubUrl: string | null) {
  void import("epubjs");
  void import("@/components/reader/reader");
  if (!epubUrl || files.has(epub)) return;
  const p = loadBookFile(epub, epubUrl);
  p.catch(() => files.delete(epub));
  files.set(epub, p);
}

/** The book file, reusing a download already started by `warmBook`. */
export function bookFile(epub: string, epubUrl: string): Promise<ArrayBuffer> {
  const hit = files.get(epub);
  if (hit) {
    files.delete(epub);
    return hit;
  }
  return loadBookFile(epub, epubUrl);
}

export function handOff(id: string, h: Handoff) {
  try {
    sessionStorage.setItem(key(id), JSON.stringify(h));
  } catch {
    /* private mode: the reader waits for its query instead */
  }
}

/** What the library handed over for this book, read once. */
export function takeHandoff(id: string): Handoff | null {
  try {
    const raw = sessionStorage.getItem(key(id));
    if (!raw) return null;
    sessionStorage.removeItem(key(id));
    const h = JSON.parse(raw) as Handoff;
    return typeof h.epub === "string" && typeof h.epubUrl === "string" && typeof h.cfi === "string" ? h : null;
  } catch {
    return null;
  }
}
