import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** A paragraph label the model can cite and the reader can jump to: [¶section.para]. */
export const label = (section: number, para: number) => `[¶${section}.${para}]`;

const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * The book's text that ends at `to` (inclusive), going back at most `maxWords`, one labelled
 * paragraph per line. Nothing after `to` is ever included, so answers can't spoil what's ahead.
 */
export async function textBefore(
  ctx: QueryCtx,
  bookId: Id<"books">,
  to: { section: number; para: number },
  maxWords: number,
) {
  const sections = await ctx.db
    .query("sections")
    .withIndex("by_book", (q) => q.eq("bookId", bookId).lte("index", to.section))
    .order("desc")
    .collect();
  const lines: string[] = [];
  let words = 0;
  let truncated = false;
  outer: for (const s of sections) {
    const last = s.index === to.section ? Math.min(to.para, s.paragraphs.length - 1) : s.paragraphs.length - 1;
    for (let p = last; p >= 0; p--) {
      const n = count(s.paragraphs[p]);
      if (words + n > maxWords && lines.length) {
        truncated = true;
        break outer;
      }
      words += n;
      lines.push(`${label(s.index, p)} ${s.paragraphs[p]}`);
    }
  }
  return { text: lines.reverse().join("\n"), truncated };
}

/** A few paragraphs of one section, labelled. */
export async function paragraphsOf(ctx: QueryCtx, bookId: Id<"books">, section: number, from: number, to: number) {
  const s = await ctx.db
    .query("sections")
    .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("index", section))
    .unique();
  const paras = s?.paragraphs ?? [];
  const out: string[] = [];
  for (let p = Math.max(0, from); p <= Math.min(to, paras.length - 1); p++) out.push(`${label(section, p)} ${paras[p]}`);
  return { text: out.join("\n"), paragraphs: paras };
}

/** The words of an anchor, as they read in the stored text. */
export function quoteOf(paragraphs: string[], a: { startPara: number; startWord: number; endPara: number; endWord: number }) {
  const parts: string[] = [];
  for (let p = a.startPara; p <= a.endPara; p++) {
    const w = (paragraphs[p] ?? "").split(/\s+/).filter(Boolean);
    parts.push(w.slice(p === a.startPara ? a.startWord : 0, p === a.endPara ? a.endWord + 1 : undefined).join(" "));
  }
  return parts.filter(Boolean).join(" ");
}

/** Spaced review intervals: a kept item comes back after 3 days, then a week, two weeks, a month… */
export const REVIEW_DAYS = [3, 7, 14, 30, 60, 120];
export const DAY = 86_400_000;
