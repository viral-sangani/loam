import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { vAudioFile, vProgress } from "./schema";

export async function requireUser(ctx: QueryCtx | MutationCtx) {
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

/** Records that the signed-in user uploaded this file. Called right after each upload. */
export const registerUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await requireUser(ctx);
    // Only fresh uploads can be registered: the uploader does it right away, and an ID learned later
    // (e.g. from a file URL) can't be used to claim someone else's file.
    const file = await ctx.db.system.get(storageId);
    if (!file || Date.now() - file._creationTime > 10 * 60_000) throw new ConvexError("File not found");
    const existing = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique();
    if (existing) {
      if (existing.userId !== userId) throw new ConvexError("File not found");
      return;
    }
    await ctx.db.insert("uploads", { storageId, userId });
  },
});

/** Links an uploaded file to a book. Only the uploader can, and only to one book. */
async function claimFile(ctx: MutationCtx, userId: Id<"users">, storageId: Id<"_storage">, bookId: Id<"books">) {
  const upload = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (!upload || upload.userId !== userId || (upload.bookId && upload.bookId !== bookId)) {
    throw new ConvexError("File not found");
  }
  await ctx.db.patch(upload._id, { bookId });
}

/** Deletes a stored file, but only if the given user uploaded it. */
async function deleteOwnFile(ctx: MutationCtx, userId: Id<"users">, storageId: Id<"_storage">) {
  const upload = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (!upload || upload.userId !== userId) return;
  await ctx.db.delete(upload._id);
  await ctx.storage.delete(storageId).catch(() => {});
}

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
        description: b.description ?? null,
        wordCount: b.wordCount,
        addedAt: b.addedAt,
        openedAt: b.openedAt ?? null,
        progress: b.progress ?? null,
        epub: b.epub,
        epubUrl: await ctx.storage.getUrl(b.epub),
        coverUrl: b.cover ? await ctx.storage.getUrl(b.cover) : null,
        terms: b.terms,
        audio: b.audio
          ? {
              status: b.audio.status,
              progress: b.audio.progress,
              stage: b.audio.stage,
              error: b.audio.error,
              coverage: b.audio.coverage ?? null,
              durationMs: b.audio.files.reduce((n, f) => n + (f.durationMs ?? 0), 0) || null,
            }
          : null,
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
      /** When it was last opened before now (saving progress updates it). */
      openedAt: book.openedAt ?? null,
      description: book.description ?? null,
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
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const bookId = await ctx.db.insert("books", {
      ...args,
      userId,
      addedAt: Date.now(),
      terms: { status: "waiting", done: 0, total: 0 },
    });
    await claimFile(ctx, userId, args.epub, bookId);
    if (args.cover) await claimFile(ctx, userId, args.cover, bookId);
    return bookId;
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
    for (const s of sections) await ctx.db.insert("sections", { bookId, ...s, words: countWords(s.paragraphs) });
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
    for (const f of files) if (f) await deleteOwnFile(ctx, book.userId, f);
    for (const table of ["sections", "timings", "terms", "briefs", "marks", "asks", "sectionSummaries", "recaps"] as const) {
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
    for (const f of files) await claimFile(ctx, book.userId, f.storageId, bookId);
    const keep = new Set(files.map((f) => f.storageId));
    for (const f of book.audio?.files ?? []) if (!keep.has(f.storageId)) await deleteOwnFile(ctx, book.userId, f.storageId);
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

const countWords = (paragraphs: string[]) => paragraphs.reduce((n, p) => n + (p.match(/\S+/g)?.length ?? 0), 0);

/** Fill in the publisher's blurb (for books added before descriptions were stored). */
export const setDescription = mutation({
  args: { bookId: v.id("books"), description: v.string() },
  handler: async (ctx, { bookId, description }) => {
    await ownBook(ctx, bookId);
    // An empty string records that the EPUB has no blurb, so it isn't read again.
    await ctx.db.patch(bookId, { description: description.trim().slice(0, 4000) });
  },
});

/** The book's shape for the reading map: each section's length in words. */
export const outline = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return sections.map((s) => ({ index: s.index, words: s.words ?? countWords(s.paragraphs), paragraphs: s.paragraphs.length }));
  },
});

/** The opening of the book's text, for reading a little before starting it. */
export const preview = query({
  args: { bookId: v.id("books"), words: v.optional(v.number()) },
  handler: async (ctx, { bookId, words = 1200 }) => {
    await ownBook(ctx, bookId);
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .take(40);
    const out: { section: number; para: number; text: string }[] = [];
    let n = 0;
    for (const s of sections) {
      // Skip title pages, contents and the like.
      if ((s.words ?? countWords(s.paragraphs)) < 120) continue;
      for (const [i, p] of s.paragraphs.entries()) {
        out.push({ section: s.index, para: i, text: p });
        n += p.match(/\S+/g)?.length ?? 0;
        if (n >= Math.min(words, 4000)) return out;
      }
    }
    return out;
  },
});

/** Counts for the shelf: highlights, notes, questions, looked-up terms, recap. */
export const extras = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
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
    const terms = await ctx.db
      .query("terms")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    const recap = await ctx.db
      .query("recaps")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .order("desc")
      .first();
    return {
      highlights: marks.length,
      notes: marks.filter((m) => m.note).length,
      questions: asks.length,
      terms: terms.length,
      lookedUp: briefs.filter((b) => b.lookedUpAt).length,
      recap: recap?.status === "ready",
    };
  },
});

/** One-off: store word counts on sections uploaded before they were kept. */
export const backfillWords = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for await (const s of ctx.db.query("sections")) {
      if (s.words === undefined) {
        await ctx.db.patch(s._id, { words: countWords(s.paragraphs) });
        n++;
      }
    }
    return n;
  },
});

/** Where every "learn more" term sits, for the reading map. */
export const termPositions = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    const rows = await ctx.db
      .query("terms")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return rows.map((t) => ({ section: t.section, para: t.para }));
  },
});
