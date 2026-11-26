import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { vAudioFile, vProgress } from "./schema";

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Not signed in");
  return userId;
}

/** The book, if it belongs to the signed-in user. */
export async function ownBook(ctx: QueryCtx | MutationCtx, bookId: Id<"books">) {
  const userId = await requireUser(ctx);
  const book = await ctx.db.get(bookId);
  if (!book || book.userId !== userId) throw new ConvexError("Book not found");
  return book;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const books = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    books.sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt));
    return Promise.all(
      books.map(async (b) => ({
        _id: b._id,
        title: b.title,
        author: b.author,
        progress: b.progress ?? null,
        coverUrl: b.cover ? await ctx.storage.getUrl(b.cover) : null,
        terms: b.terms,
        audio: b.audio ? { status: b.audio.status, progress: b.audio.progress, stage: b.audio.stage, error: b.audio.error } : null,
      })),
    );
  },
});

export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const userId = await getAuthUserId(ctx);
    const book = await ctx.db.get(bookId);
    if (!userId || !book || book.userId !== userId) return null;
    const audioFiles = book.audio
      ? await Promise.all(book.audio.files.map(async (f) => ({ ...f, url: await ctx.storage.getUrl(f.storageId) })))
      : [];
    return {
      _id: book._id,
      title: book.title,
      author: book.author,
      epub: book.epub,
      epubUrl: await ctx.storage.getUrl(book.epub),
      progress: book.progress ?? null,
      audio: book.audio ? { ...book.audio, files: audioFiles } : null,
    };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    author: v.string(),
    epub: v.id("_storage"),
    cover: v.optional(v.id("_storage")),
    wordCount: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return ctx.db.insert("books", {
      ...args,
      userId,
      addedAt: Date.now(),
      terms: { status: "waiting", done: 0, total: 0 },
    });
  },
});

/** The client uploads the book's text in batches of sections, then calls `finishUpload`. */
export const addSections = mutation({
  args: {
    bookId: v.id("books"),
    sections: v.array(v.object({ index: v.number(), paragraphs: v.array(v.string()) })),
  },
  handler: async (ctx, { bookId, sections }) => {
    await ownBook(ctx, bookId);
    for (const s of sections) await ctx.db.insert("sections", { bookId, ...s });
  },
});

export const finishUpload = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    await ctx.scheduler.runAfter(0, internal.terms.start, { bookId });
  },
});

export const remove = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const book = await ownBook(ctx, bookId);
    const files = [book.epub, book.cover, ...(book.audio?.files.map((f) => f.storageId) ?? [])];
    for (const f of files) if (f) await ctx.storage.delete(f).catch(() => {});
    for (const table of ["sections", "timings", "terms", "briefs"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_book", (q) => q.eq("bookId", bookId))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(bookId);
  },
});

export const saveProgress = mutation({
  args: { bookId: v.id("books"), progress: vProgress },
  handler: async (ctx, { bookId, progress }) => {
    await ownBook(ctx, bookId);
    await ctx.db.patch(bookId, { progress, openedAt: Date.now() });
  },
});

// ---- audiobook -------------------------------------------------------------

/** Attach uploaded audio files (in listening order) and queue the word-timing job. */
export const attachAudio = mutation({
  args: { bookId: v.id("books"), files: v.array(vAudioFile) },
  handler: async (ctx, { bookId, files }) => {
    const book = await ownBook(ctx, bookId);
    for (const f of book.audio?.files ?? []) await ctx.storage.delete(f.storageId).catch(() => {});
    const old = await ctx.db
      .query("timings")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    for (const t of old) await ctx.db.delete(t._id);
    await ctx.db.patch(bookId, { audio: { files, status: "queued", progress: 0, stage: "Waiting for the aligner" } });
  },
});

export const saveAudioPosition = mutation({
  args: { bookId: v.id("books"), positionMs: v.number() },
  handler: async (ctx, { bookId, positionMs }) => {
    const book = await ownBook(ctx, bookId);
    if (book.audio) await ctx.db.patch(bookId, { audio: { ...book.audio, positionMs } });
  },
});

// ---- reading data ----------------------------------------------------------

/** Where each section sits on the audio timeline. */
export const timingIndex = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    const rows = await ctx.db
      .query("timings")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return rows.filter((r) => r.startMs >= 0).map((r) => ({ section: r.section, startMs: r.startMs, endMs: r.endMs }));
  },
});

export const sectionTimings = query({
  args: { bookId: v.id("books"), section: v.number() },
  handler: async (ctx, { bookId, section }) => {
    await ownBook(ctx, bookId);
    const row = await ctx.db
      .query("timings")
      .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("section", section))
      .unique();
    return row?.starts ?? null;
  },
});

export const sectionTerms = query({
  args: { bookId: v.id("books"), section: v.number() },
  handler: async (ctx, { bookId, section }) => {
    await ownBook(ctx, bookId);
    const rows = await ctx.db
      .query("terms")
      .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("section", section))
      .collect();
    return rows.map((t) => ({ _id: t._id, para: t.para, term: t.term }));
  },
});
