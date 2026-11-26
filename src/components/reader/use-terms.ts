"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import type { Contents } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { findTerm, tokenize, wordRange, paragraphText } from "@/lib/book-text";
import { caretAt, paint, paragraphsOf } from "./highlights";

type Placed = { termId: Id<"terms">; range: Range };

/**
 * Underlines the "learn more" terms of the section on screen, and reports which one a click hit.
 * Terms stream in while the book is still being processed; the underlines update as they arrive.
 */
export function useTerms(bookId: Id<"books">, contents: Contents | null, onOpen: (termId: Id<"terms">) => void) {
  const section = contents?.sectionIndex;
  const terms = useQuery(api.books.sectionTerms, section === undefined ? "skip" : { bookId, section });
  const placed = useRef<Placed[]>([]);

  useEffect(() => {
    if (!contents || !terms) return;
    const paras = paragraphsOf(contents);
    const out: Placed[] = [];
    for (const t of terms) {
      const el = paras[t.para];
      if (!el) continue;
      const hit = findTerm(tokenize(paragraphText(el)), t.term);
      const range = hit && wordRange(el, hit[0], hit[1]);
      if (range) out.push({ termId: t._id, range });
    }
    placed.current = out;
    paint(contents, "loam-term", out.map((p) => p.range));
  }, [contents, terms]);

  /** Opens the term under a click, if there is one. */
  const press = useCallback(
    (c: Contents, x: number, y: number) => {
      const pos = caretAt(c.document, x, y);
      if (!pos) return false;
      const hit = placed.current.find((p) => {
        try {
          return p.range.isPointInRange(pos.node, pos.offset);
        } catch {
          return false;
        }
      });
      if (!hit) return false;
      onOpen(hit.termId);
      return true;
    },
    [onOpen],
  );

  return { press };
}
