/**
 * Functions for the local aligner (`npm run aligner`), which times every word of a book
 * against its audiobook on the user's machine. Guarded by the WORKER_SECRET shared secret.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

function check(secret: string) {
  if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) throw new ConvexError("Bad worker secret");
}

export const pending = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    check(secret);
    const books = await ctx.db.query("books").collect();
    return books
      .filter((b) => b.audio && (b.audio.status === "queued" || b.audio.status === "aligning"))
      .map((b) => ({ bookId: b._id, title: b.title }));
  },
});

export const job = query({
  args: { secret: v.string(), bookId: v.id("books") },
  handler: async (ctx, { secret, bookId }) => {
    check(secret);
    const book = await ctx.db.get(bookId);
    if (!book?.audio) return null;
    const files = await Promise.all(book.audio.files.map(async (f) => ({ ...f, url: await ctx.storage.getUrl(f.storageId) })));
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return { title: book.title, files, sections: sections.map((s) => ({ index: s.index, paragraphs: s.paragraphs })) };
  },
});

type Audio = NonNullable<Doc<"books">["audio"]>;

export const update = mutation({
  args: {
    secret: v.string(),
    bookId: v.id("books"),
    status: v.optional(v.union(v.literal("aligning"), v.literal("ready"), v.literal("error"))),
    progress: v.optional(v.number()),
    stage: v.optional(v.string()),
    error: v.optional(v.string()),
    coverage: v.optional(v.number()),
    durationsMs: v.optional(v.array(v.number())),
  },
  handler: async (ctx, { secret, bookId, durationsMs, ...patch }) => {
    check(secret);
    const book = await ctx.db.get(bookId);
    if (!book?.audio) return;
    const audio: Audio = { ...book.audio };
    for (const [k, val] of Object.entries(patch)) if (val !== undefined) (audio as Record<string, unknown>)[k] = val;
    if (durationsMs) audio.files = audio.files.map((f, i) => ({ ...f, durationMs: durationsMs[i] }));
    await ctx.db.patch(bookId, { audio });
  },
});

export const saveTimings = mutation({
  args: {
    secret: v.string(),
    bookId: v.id("books"),
    sections: v.array(v.object({ section: v.number(), starts: v.array(v.number()), startMs: v.number(), endMs: v.number() })),
  },
  handler: async (ctx, { secret, bookId, sections }) => {
    check(secret);
    for (const s of sections) {
      const old = await ctx.db
        .query("timings")
        .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("section", s.section))
        .unique();
      if (old) await ctx.db.replace(old._id, { bookId, ...s });
      else await ctx.db.insert("timings", { bookId, ...s });
    }
  },
});
