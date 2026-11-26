import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownBook } from "./books";

/** Everything you marked, asked and looked up in a book. The client sorts it into reading order. */
export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const book = await ownBook(ctx, bookId);
    const marks = await ctx.db
      .query("marks")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    const asks = await ctx.db
      .query("asks")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    const lookups = [];
    for (const b of briefs) {
      if (!b.lookedUpAt || b.status !== "ready" || !b.data) continue;
      const term = await ctx.db.get(b.termId);
      if (!term) continue;
      lookups.push({
        _id: b._id,
        termId: term._id,
        term: term.term,
        section: term.section,
        para: term.para,
        title: b.data.title,
        summary: b.data.summary,
        context: b.data.context,
        lookedUpAt: b.lookedUpAt,
      });
    }
    return {
      title: book.title,
      author: book.author,
      marks: marks.map((m) => ({ _id: m._id, anchor: m.anchor, quote: m.quote, color: m.color ?? null, note: m.note ?? null, createdAt: m.createdAt })),
      asks: asks.map((a) => ({
        _id: a._id,
        kind: a.kind,
        question: a.question,
        quote: a.quote ?? null,
        anchor: a.anchor ?? null,
        position: a.position ?? null,
        status: a.status,
        answer: a.answer ?? null,
        createdAt: a.createdAt,
      })),
      lookups,
    };
  },
});
