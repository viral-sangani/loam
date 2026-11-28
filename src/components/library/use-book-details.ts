"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { findTerm, tokenize } from "@/lib/book-text";
import type { Extras, PreviewPara } from "./model";
import { usePublicLibrary } from "./use-public-library";
import { libraryPath, type PublicPreview } from "@/lib/public-library";

const EMPTY_PREVIEW: PublicPreview = [];

/** Counts for one book (highlights, notes, terms…), or undefined while loading. */
export function useExtras(bookId: string | null): Extras | undefined {
  return useQuery(api.books.extras, bookId ? { bookId: bookId as Id<"books"> } : "skip");
}

/**
 * The opening paragraphs of a book with the words Loam can explain marked, for the
 * "Before you start" pages. Undefined while loading.
 */
export function usePreview(bookId: string | null, owner: boolean, words = 900): PreviewPara[] | undefined {
  const id = owner ? bookId as Id<"books"> | null : null;
  const publicPreview = usePublicLibrary<PublicPreview>(!owner && bookId ? libraryPath(bookId, "preview") : null);
  const privatePreview = useQuery(api.books.preview, id ? { bookId: id, words } : "skip");
  const preview = owner ? privatePreview : publicPreview?.data ?? (publicPreview ? EMPTY_PREVIEW : undefined);
  const sections = useMemo(() => [...new Set((preview ?? []).map((p) => p.section))].slice(0, 2), [preview]);
  const t0 = useQuery(api.books.sectionTerms, id && sections[0] !== undefined ? { bookId: id, section: sections[0] } : "skip");
  const t1 = useQuery(api.books.sectionTerms, id && sections[1] !== undefined ? { bookId: id, section: sections[1] } : "skip");

  return useMemo(() => {
    if (!preview) return undefined;
    const terms = new Map<string, string[]>();
    const add = (section: number, rows: { para: number; term: string }[] | undefined) => {
      for (const r of rows ?? []) {
        const k = `${section}:${r.para}`;
        terms.set(k, [...(terms.get(k) ?? []), r.term]);
      }
    };
    if (sections[0] !== undefined) add(sections[0], t0);
    if (sections[1] !== undefined) add(sections[1], t1);
    return preview.map((p) => {
      const words = tokenize(p.text);
      const marked = words.map(() => false);
      for (const term of terms.get(`${p.section}:${p.para}`) ?? []) {
        const hit = findTerm(words, term);
        if (hit) for (let i = hit[0]; i <= hit[1]; i++) marked[i] = true;
      }
      return { section: p.section, para: p.para, words, marked };
    });
  }, [preview, sections, t0, t1]);
}
