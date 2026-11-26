import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownBook } from "./books";
import { vAnchor } from "./schema";
import { DAY, quoteOf } from "./text";

/** Highlights of a book (or of one section), with their notes. */
export const list = query({
  args: { bookId: v.id("books"), section: v.optional(v.number()) },
  handler: async (ctx, { bookId, section }) => {
    await ownBook(ctx, bookId);
    const rows = await ctx.db
      .query("marks")
      .withIndex("by_book", (q) => (section === undefined ? q.eq("bookId", bookId) : q.eq("bookId", bookId).eq("anchor.section", section)))
      .collect();
    return rows.map((m) => ({ _id: m._id, anchor: m.anchor, quote: m.quote, color: m.color ?? null, note: m.note ?? null, createdAt: m.createdAt }));
  },
});

export const create = mutation({
  args: { bookId: v.id("books"), anchor: vAnchor, color: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { bookId, anchor, color, note }) => {
    const book = await ownBook(ctx, bookId);
    const section = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("index", anchor.section))
      .unique();
    if (!section) throw new ConvexError("Section not found");
    const quote = quoteOf(section.paragraphs, anchor);
    if (!quote) throw new ConvexError("Nothing selected");
    const now = Date.now();
    return ctx.db.insert("marks", {
      bookId,
      userId: book.userId,
      anchor,
      quote: quote.slice(0, 4000),
      color,
      note: note?.trim() || undefined,
      createdAt: now,
      // First shows up in the daily review tomorrow.
      dueAt: now + DAY,
      reviewStep: 0,
    });
  },
});

export const update = mutation({
  args: { markId: v.id("marks"), note: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, { markId, note, color }) => {
    const mark = await ctx.db.get(markId);
    if (!mark) throw new ConvexError("Highlight not found");
    await ownBook(ctx, mark.bookId);
    await ctx.db.patch(markId, {
      ...(note !== undefined ? { note: note.trim() || undefined } : {}),
      ...(color !== undefined ? { color } : {}),
    });
  },
});

export const remove = mutation({
  args: { markId: v.id("marks") },
  handler: async (ctx, { markId }) => {
    const mark = await ctx.db.get(markId);
    if (!mark) return;
    await ownBook(ctx, mark.bookId);
    await ctx.db.delete(markId);
  },
});
