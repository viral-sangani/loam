"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Books live in Convex now. The browser keeps reader settings and two caches:
 * the EPUB file (so reopening a book is instant) and epub.js's location index (for percentages).
 */

export type Progress = {
  cfi: string;
  percent: number | null; // 0..1, null until locations are generated
  chapter: string | null;
};

export type ReaderPrefs = {
  fontSize: number; // percent
  lineHeight: number;
  theme: "light" | "dark";
  showProgress: boolean;
};

export const DEFAULT_PREFS: ReaderPrefs = { fontSize: 105, lineHeight: 1.65, theme: "light", showProgress: true };

interface CacheDB extends DBSchema {
  files: { key: string; value: Blob }; // by storage id
  locations: { key: string; value: string }; // by book id
}

let dbPromise: Promise<IDBPDatabase<CacheDB>> | null = null;
const db = () => (dbPromise ??= openDB<CacheDB>("loam-cache", 1, {
  upgrade(d) {
    d.createObjectStore("files");
    d.createObjectStore("locations");
  },
}));

/** The book file, from the local cache or downloaded once from storage. */
export async function loadBookFile(storageId: string, url: string): Promise<ArrayBuffer> {
  try {
    const hit = await (await db()).get("files", storageId);
    if (hit) return hit.arrayBuffer();
  } catch {
    /* cache is best effort */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the book (${res.status})`);
  const blob = await res.blob();
  void db().then((d) => d.put("files", blob, storageId)).catch(() => {});
  return blob.arrayBuffer();
}

export async function cacheBookFile(storageId: string, file: Blob) {
  try {
    await (await db()).put("files", file, storageId);
  } catch {
    /* best effort */
  }
}

export async function getLocations(id: string) {
  try {
    return await (await db()).get("locations", id);
  } catch {
    return undefined;
  }
}

export async function saveLocations(id: string, json: string) {
  try {
    await (await db()).put("locations", json, id);
  } catch {
    /* best effort */
  }
}

const PREFS_KEY = "loam:reader-prefs";
export function loadPrefs(): ReaderPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(p: ReaderPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
