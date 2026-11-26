import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vProgress = v.object({
  cfi: v.string(),
  percent: v.union(v.number(), v.null()),
  chapter: v.union(v.string(), v.null()),
});

export const vAudioFile = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  size: v.number(),
  /** Filled in by the aligner. */
  durationMs: v.optional(v.number()),
});

export default defineSchema({
  users: defineTable({ createdAt: v.number() }),

  /** Who uploaded each stored file, and which book it belongs to, so files can't be claimed across accounts. */
  uploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    bookId: v.optional(v.id("books")),
  }).index("by_storage", ["storageId"]),

  books: defineTable({
    userId: v.id("users"),
    title: v.string(),
    author: v.string(),
    epub: v.id("_storage"),
    cover: v.optional(v.id("_storage")),
    addedAt: v.number(),
    openedAt: v.optional(v.number()),
    progress: v.optional(vProgress),
    wordCount: v.number(),
    /** Finding "learn more" words with the AI, one section at a time. */
    terms: v.object({
      status: v.union(v.literal("waiting"), v.literal("running"), v.literal("done"), v.literal("error")),
      done: v.number(),
      total: v.number(),
      error: v.optional(v.string()),
    }),
    /** The audiobook and the job that times every word of the book against it. */
    audio: v.optional(
      v.object({
        files: v.array(vAudioFile),
        status: v.union(v.literal("queued"), v.literal("aligning"), v.literal("ready"), v.literal("error")),
        progress: v.number(), // 0..1
        stage: v.optional(v.string()),
        error: v.optional(v.string()),
        /** Share of the book's words heard in the audio (0..1). */
        coverage: v.optional(v.number()),
        positionMs: v.optional(v.number()),
      }),
    ),
  }).index("by_user", ["userId"]),

  /** The book's text, split the same way the reader splits it: paragraphs of words. */
  sections: defineTable({
    bookId: v.id("books"),
    index: v.number(), // spine index
    paragraphs: v.array(v.string()),
  }).index("by_book", ["bookId", "index"]),

  /** When each word of a section is spoken: one start time (ms) per word, -1 when not narrated. */
  timings: defineTable({
    bookId: v.id("books"),
    section: v.number(),
    starts: v.array(v.number()),
    startMs: v.number(),
    endMs: v.number(),
  }).index("by_book", ["bookId", "section"]),

  /** Words the AI thinks are worth a closer look, anchored to a paragraph. */
  terms: defineTable({
    bookId: v.id("books"),
    section: v.number(),
    para: v.number(),
    term: v.string(),
  })
    .index("by_book", ["bookId", "section"]),

  briefs: defineTable({
    termId: v.id("terms"),
    bookId: v.id("books"),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("error")),
    error: v.optional(v.string()),
    data: v.optional(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        summary: v.string(),
        points: v.array(v.string()),
        context: v.string(),
        image: v.optional(v.string()),
        wikiUrl: v.optional(v.string()),
        video: v.optional(v.object({ id: v.string(), title: v.string() })),
        videoSearch: v.string(),
      }),
    ),
  })
    .index("by_term", ["termId"])
    .index("by_book", ["bookId"]),
});
