"use client";

import { useSyncExternalStore } from "react";
import type { ListedBook } from "./model";
import type { LibraryView } from "./view-mode";

/** What both library views get from the shelf: the books, and the shelf's own actions. */
export type LibraryProps = {
  books: ListedBook[] | undefined;
  /** Audio upload progress (0..1) by book. */
  uploads: Record<string, number>;
  /** An EPUB is being added. */
  busy: boolean;
  error: string | null;
  addBooks: () => void;
  addAudio: (bookId: string) => void;
  remove: (bookId: string) => Promise<void>;
  signOut: () => void;
  owner: boolean;
  checking: boolean;
  setShared: (bookId: string, shared: boolean) => Promise<void>;
  view: LibraryView;
  setView: (v: LibraryView) => void;
  canRoom: boolean;
};

export function useMedia(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const m = matchMedia(query);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

const sizeKey = () => `${window.innerWidth}x${window.innerHeight}`;
/** The window's size, kept current. */
export function useViewport() {
  const key = useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    sizeKey,
    () => "1280x800",
  );
  const [w, h] = key.split("x").map(Number);
  return { w, h };
}
