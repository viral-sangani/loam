"use client";

import type { ListedBook } from "./model";

const KEY = "loam:books:v1";

let memo: ListedBook[] | null | undefined;

/** Read once per page load, so it can be a stable snapshot. */
export function readCachedBooks(): ListedBook[] | null {
  if (memo !== undefined) return memo;
  memo = parse();
  return memo;
}

function parse(): ListedBook[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    const books = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(books) ? (books as ListedBook[]) : null;
  } catch {
    return null;
  }
}

export function saveCachedBooks(books: ListedBook[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(books));
  } catch {
    /* storage full or blocked: the list just loads from the server next time */
  }
}

export function clearCachedBooks() {
  memo = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
