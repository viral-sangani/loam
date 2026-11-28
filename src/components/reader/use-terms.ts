"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Contents } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { findTerm, tokenize, wordRange, paragraphText } from "@/lib/book-text";
import { paint, paragraphsOf } from "./highlights";

export type ReaderTerm = FunctionReturnType<typeof api.books.sectionTerms>[number];
type Placed = { term: ReaderTerm; paragraph: Element; range: Range };

/**
 * Underlines the "learn more" terms of the section on screen, and reports which one a click hit.
 * Terms stream in while the book is still being processed; the underlines update as they arrive.
 */
export function useTerms(bookId: Id<"books">, contents: Contents | null, onOpen: (term: ReaderTerm) => void) {
  const section = contents?.sectionIndex;
  const terms = useQuery(api.books.sectionTerms, section === undefined ? "skip" : { bookId, section, includeExplanation: true });
  const placed = useRef(new WeakMap<Document, Placed[]>());

  useEffect(() => {
    if (!contents || !terms) return;
    const paras = paragraphsOf(contents);
    const out: Placed[] = [];
    for (const t of terms) {
      const el = paras[t.para];
      if (!el) continue;
      const hit = findTerm(tokenize(paragraphText(el)), t.term);
      const range = hit && wordRange(el, hit[0], hit[1]);
      if (range) out.push({ term: t, paragraph: el, range });
    }
    placed.current.set(contents.document, out);
    paint(contents, "loam-term", out.map((p) => p.range));
  }, [contents, terms]);

  const byId = useMemo(() => new Map(terms?.map((term) => [term._id, term])), [terms]);

  /** Opens the term under a click, if there is one. */
  const press = useCallback(
    (c: Contents, x: number, y: number) => {
      const target = c.document.elementFromPoint(x, y);
      if (!target) return false;
      const hit = placed.current.get(c.document)?.find(({ paragraph, range }) =>
        paragraph.contains(target) && Array.from(range.getClientRects()).some(
          // The dots sit just below the glyphs, outside the browser's text caret hit area.
          (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 4,
        ),
      );
      if (!hit) return false;
      onOpen(hit.term);
      return true;
    },
    [onOpen],
  );

  return { press, byId };
}
