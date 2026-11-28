import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { ownBook } from "./books";

const MAX_BOOKS = 100;
const MiB = 1024 * 1024;

export const setShared = mutation({
  args: { bookId: v.id("books"), shared: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { bookId, shared }) => {
    const book = await ownBook(ctx, bookId);
    if (shared && !book.shared) {
      const books = await sharedBooks(ctx, book.userId);
      if (books.length >= MAX_BOOKS) throw new ConvexError("The public shelf is full");
    }
    await ctx.db.patch(bookId, { shared });
    return null;
  },
});

function sharedBooks(ctx: MutationCtx, userId: Id<"users">) {
  return ctx.db.query("books")
    .withIndex("by_user_shared", (q) => q.eq("userId", userId).eq("shared", true))
    .order("desc")
    .take(MAX_BOOKS);
}

function publicBook(book: Doc<"books">) {
  const { _id, title, author, description, wordCount, addedAt, cover, audio } = book;
  return {
    _id, title, author, description: description ?? null, wordCount, addedAt,
    hasCover: !!cover, audioFiles: Math.min(audio?.files.length ?? 0, 200),
    durationMs: audio?.files.reduce((sum, file) => sum + (file.durationMs ?? 0), 0) || null,
  };
}

const vBook = v.object({
  _id: v.id("books"), title: v.string(), author: v.string(), description: v.union(v.string(), v.null()),
  wordCount: v.number(), addedAt: v.number(), hasCover: v.boolean(), audioFiles: v.number(),
  durationMs: v.union(v.number(), v.null()),
});

const vAudio = v.object({ name: v.string(), size: v.number(), durationMs: v.optional(v.number()) });
const vPreview = v.object({ section: v.number(), para: v.number(), text: v.string() });
const limited = { kind: "limited" } as const;
const missing = { kind: "missing" } as const;

async function reserve(ctx: MutationCtx) {
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  const day = Math.floor(now / 86_400_000);
  const minute = Math.floor(now / 60_000);
  const previous = await ctx.db.query("publicUsage").first();
  const next = {
    month, day, minute,
    monthRequests: previous?.month === month ? previous.monthRequests + 1 : 1,
    dayRequests: previous?.day === day ? previous.dayRequests + 1 : 1,
    minuteRequests: previous?.minute === minute ? previous.minuteRequests + 1 : 1,
    monthBytes: previous?.month === month ? previous.monthBytes : 0,
    dayBytes: previous?.day === day ? previous.dayBytes : 0,
  };
  if (next.monthRequests > 6000 || next.dayRequests > 700 || next.minuteRequests > 90) return null;
  const id = previous ? previous._id : await ctx.db.insert("publicUsage", next);
  if (previous) await ctx.db.replace(id, next);
  return { id, ...next };
}

function byteRange(size: number, range: string) {
  if (!range) return { bytes: size, range: "" };
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (start > end || start >= size) return null;
  return { bytes: end - start + 1, range: `bytes=${start}-${end}` };
}

/** Only the Next.js server can read the shelf or retrieve an upstream file URL. */
export const read = mutation({
  args: {
    key: v.string(),
    request: v.union(
      v.object({ kind: v.literal("catalog") }),
      v.object({ kind: v.union(v.literal("book"), v.literal("preview")), id: v.string() }),
      v.object({ kind: v.literal("file"), id: v.string(), asset: v.union(v.literal("cover"), v.literal("epub"), v.number()), range: v.string() }),
    ),
  },
  returns: v.union(
    v.object({ kind: v.literal("limited") }),
    v.object({ kind: v.literal("missing") }),
    v.object({ kind: v.literal("catalog"), books: v.array(vBook) }),
    v.object({ kind: v.literal("book"), book: vBook, audio: v.array(vAudio) }),
    v.object({ kind: v.literal("preview"), paragraphs: v.array(vPreview) }),
    v.object({ kind: v.literal("range"), size: v.number() }),
    v.object({ kind: v.literal("file"), url: v.string(), mime: v.string(), range: v.string(), bytes: v.number(), size: v.number() }),
  ),
  handler: async (ctx, { key, request }) => {
    if (!process.env.LOAM_PUBLIC_KEY || key !== process.env.LOAM_PUBLIC_KEY) return missing;
    const userId = ctx.db.normalizeId("users", process.env.LOAM_OWNER_ID ?? "");
    if (!userId) return missing;
    const usage = await reserve(ctx);
    if (!usage) return limited;
    if (request.kind === "catalog") {
      return { kind: "catalog" as const, books: (await sharedBooks(ctx, userId)).map(publicBook) };
    }
    const bookId = ctx.db.normalizeId("books", request.id);
    const book = bookId && await ctx.db.get(bookId);
    if (!book || book.userId !== userId || !book.shared) return missing;
    if (request.kind === "book") {
      const audio = (book.audio?.files ?? []).slice(0, 200).map(({ name, size, durationMs }) => ({ name, size, ...(durationMs === undefined ? {} : { durationMs }) }));
      return { kind: "book" as const, book: publicBook(book), audio };
    }
    if (request.kind === "preview") {
      const sections = await ctx.db.query("sections").withIndex("by_book", (q) => q.eq("bookId", book._id)).take(12);
      const paragraphs: { section: number; para: number; text: string }[] = [];
      let remaining = 900;
      for (const section of sections) {
        if (section.words !== undefined && section.words < 120) continue;
        for (const [para, text] of section.paragraphs.entries()) {
          const words = text.slice(0, 8000).match(/\S+/g);
          if (!words) continue;
          paragraphs.push({ section: section.index, para, text: words.slice(0, remaining).join(" ") });
          remaining -= words.length;
          if (remaining <= 0) return { kind: "preview" as const, paragraphs };
        }
      }
      return { kind: "preview" as const, paragraphs };
    }
    if (request.kind !== "file") return missing;
    const { asset } = request;
    const storageId = asset === "cover" ? book.cover : asset === "epub" ? book.epub
      : Number.isInteger(asset) && asset >= 0 && asset < 200 ? book.audio?.files[asset]?.storageId : undefined;
    if (!storageId) return missing;
    const file = await ctx.db.system.get(storageId);
    if (!file || file.size <= 0) return missing;
    const range = byteRange(file.size, request.range);
    if (!range) return { kind: "range" as const, size: file.size };
    const dayBytes = usage.dayBytes + range.bytes;
    const monthBytes = usage.monthBytes + range.bytes;
    if (dayBytes > 512 * MiB || monthBytes > 768 * MiB) return limited;
    const url = await ctx.storage.getUrl(storageId);
    if (!url) return missing;
    const type = file.contentType?.split(";")[0].toLowerCase() ?? "";
    const mime = asset === "epub" ? "application/epub+zip"
      : asset === "cover" && /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(type) ? type
      : typeof asset === "number" && /^audio\/[\w.+-]+$/.test(type) ? type
      : typeof asset === "number" ? "audio/mpeg" : "application/octet-stream";
    await ctx.db.patch(usage.id, { dayBytes, monthBytes });
    return { kind: "file" as const, url, mime, size: file.size, ...range };
  },
});
