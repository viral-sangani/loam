"use client";

import { useEffect, useRef } from "react";
import { useConvex, type ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { loadBookFile } from "./library";
import { plainText } from "./upload";

/**
 * Books added before descriptions were stored get theirs filled in from the EPUB: one book at a
 * time, in idle time. A book with no blurb is saved as "" so it is read once, ever; one that fails
 * isn't retried until the next visit.
 */

/** Books already tried this session, whatever came of it. */
const tried = new Set<string>();
/** The one backfill in flight, shared by every mount of the hook. */
let running: Promise<void> | null = null;

/** The publisher's blurb from an EPUB's metadata, as plain text ("" if there is none). */
export async function readDescription(file: ArrayBuffer): Promise<string> {
  const { default: ePub } = await import("epubjs");
  const book = ePub(file);
  try {
    const metadata = await book.loaded.metadata;
    // Let epub.js finish opening before destroying it; tearing it down mid-load throws inside epub.js.
    await book.ready.catch(() => {});
    return plainText(metadata.description ?? "");
  } finally {
    book.destroy();
  }
}

async function backfill(convex: ConvexReactClient, book: Shelved) {
  if (!book.epubUrl) return;
  const description = await readDescription(await loadBookFile(book.epub, book.epubUrl));
  await convex.mutation(api.books.setDescription, { bookId: book._id, description });
}

function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const h = requestIdleCallback(fn, { timeout: 10_000 });
    return () => cancelIdleCallback(h);
  }
  const t = setTimeout(fn, 1500);
  return () => clearTimeout(t);
}

type Shelved = { _id: Id<"books">; description: string | null; epub: string; epubUrl: string | null };

export function useDescriptionBackfill(books: Shelved[] | undefined) {
  const convex = useConvex();
  const latest = useRef(books);
  useEffect(() => {
    latest.current = books;
  }, [books]);
  const missing = !!books?.some((b) => b.description === null && !tried.has(b._id));

  useEffect(() => {
    if (!missing) return;
    let stopped = false;
    let cancel = () => {};
    const next = () => {
      if (stopped) return;
      if (running) return void running.then(next);
      const book = latest.current?.find((b) => b.description === null && !tried.has(b._id));
      if (!book) return;
      cancel = whenIdle(() => {
        if (stopped || running) return next();
        tried.add(book._id);
        running = backfill(convex, book)
          .catch((e) => console.warn("Couldn't read the description of", book._id, e))
          .finally(() => {
            running = null;
          });
        void running.then(next);
      });
    };
    next();
    return () => {
      stopped = true;
      cancel();
    };
  }, [convex, missing]);
}
