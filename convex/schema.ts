import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vProgress = v.object({
  cfi: v.string(),
  percent: v.union(v.number(), v.null()),
  chapter: v.union(v.string(), v.null()),
});

/** A place in the book: a section (spine index) and a paragraph in it, as split by src/lib/book-text.ts. */
export const vPos = v.object({ section: v.number(), para: v.number() });

/** A stretch of text, by word: from (startPara, startWord) to (endPara, endWord), inclusive, in one section. */
export const vAnchor = v.object({
  section: v.number(),
  startPara: v.number(),
  startWord: v.number(),
  endPara: v.number(),
  endWord: v.number(),
});

/** Spaced review: when an item is next due, and how many times it has been kept. */
const review = {
  dueAt: v.optional(v.number()),
  reviewStep: v.optional(v.number()),
  reviewDone: v.optional(v.boolean()),
};

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

  publicUsage: defineTable({
    month: v.string(),
    day: v.number(),
    minute: v.number(),
    monthRequests: v.number(),
    dayRequests: v.number(),
    minuteRequests: v.number(),
    monthBytes: v.number(),
    dayBytes: v.number(),
  }),

  books: defineTable({
    shared: v.optional(v.boolean()),
    userId: v.id("users"),
    title: v.string(),
    author: v.string(),
    epub: v.id("_storage"),
    cover: v.optional(v.id("_storage")),
    addedAt: v.number(),
    openedAt: v.optional(v.number()),
    progress: v.optional(vProgress),
    wordCount: v.number(),
    /** The publisher's blurb from the EPUB, as plain text. */
    description: v.optional(v.string()),
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
  }).index("by_user", ["userId"]).index("by_user_shared", ["userId", "shared"]),

  /** The book's text, split the same way the reader splits it: paragraphs of words. */
  sections: defineTable({
    bookId: v.id("books"),
    index: v.number(), // spine index
    paragraphs: v.array(v.string()),
    /** Words in the section, for the reading map. */
    words: v.optional(v.number()),
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
    /** Who looked it up and when, for the notebook and the daily review. */
    userId: v.optional(v.id("users")),
    lookedUpAt: v.optional(v.number()),
    ...review,
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
    .index("by_book", ["bookId"])
    .index("by_user_due", ["userId", "dueAt"]),

  /** Highlights, with an optional note. */
  marks: defineTable({
    bookId: v.id("books"),
    userId: v.id("users"),
    anchor: vAnchor,
    /** The highlighted text, as it reads. */
    quote: v.string(),
    color: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    ...review,
  })
    .index("by_book", ["bookId", "anchor.section"])
    .index("by_user_due", ["userId", "dueAt"]),

  /** Questions to the AI: about a selected passage, or about the whole book so far. */
  asks: defineTable({
    bookId: v.id("books"),
    userId: v.id("users"),
    kind: v.union(v.literal("explain"), v.literal("define"), v.literal("simplify"), v.literal("ask"), v.literal("book")),
    question: v.string(),
    /** The selected passage (passage questions). */
    anchor: v.optional(vAnchor),
    quote: v.optional(v.string()),
    /** Where the reader was (book questions); nothing after it is used, to avoid spoilers. */
    position: v.optional(vPos),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("error")),
    /** Markdown. Cites paragraphs as [¶section.para]; the key answer is wrapped in ==…== once. */
    answer: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_book", ["bookId"]),

  /** A short summary of each section, made once and reused by recaps. */
  sectionSummaries: defineTable({
    bookId: v.id("books"),
    section: v.number(),
    summary: v.string(),
  }).index("by_book", ["bookId", "section"]),

  /** "The story so far", up to a reading position. */
  recaps: defineTable({
    bookId: v.id("books"),
    upTo: vPos,
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("error")),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_book", ["bookId"]),
});
