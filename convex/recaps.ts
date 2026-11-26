import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ownBook } from "./books";
import { chatText } from "./llm";
import { vPos } from "./schema";
import { label } from "./text";

/** Sections shorter than this (title pages, contents) aren't summarized. */
const MIN_WORDS = 60;
/** A recap within this many paragraphs of the reader's spot is reused. */
const REUSE_PARAS = 5;

const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The latest recap of a book. */
export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    const r = await ctx.db
      .query("recaps")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .order("desc")
      .first();
    return r ? { _id: r._id, upTo: r.upTo, status: r.status, text: r.text ?? null, error: r.error ?? null, createdAt: r.createdAt } : null;
  },
});

/** "The story so far", up to `upTo`. Reuses a recent recap made from about the same spot. */
export const request = mutation({
  args: { bookId: v.id("books"), upTo: vPos, fresh: v.optional(v.boolean()) },
  handler: async (ctx, { bookId, upTo, fresh }) => {
    await ownBook(ctx, bookId);
    const last = await ctx.db
      .query("recaps")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .order("desc")
      .first();
    if (
      !fresh &&
      last &&
      last.status !== "error" &&
      last.upTo.section === upTo.section &&
      Math.abs(last.upTo.para - upTo.para) <= REUSE_PARAS
    ) {
      return last._id;
    }
    const recapId = await ctx.db.insert("recaps", { bookId, upTo, status: "pending", createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.recaps.build, { recapId });
    return recapId;
  },
});

export const plan = internalQuery({
  args: { recapId: v.id("recaps") },
  handler: async (ctx, { recapId }) => {
    const r = await ctx.db.get(recapId);
    const book = r && (await ctx.db.get(r.bookId));
    if (!r || !book) return null;
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", r.bookId).lte("index", r.upTo.section))
      .collect();
    const summaries = await ctx.db
      .query("sectionSummaries")
      .withIndex("by_book", (q) => q.eq("bookId", r.bookId).lt("section", r.upTo.section))
      .collect();
    const have = new Map(summaries.map((s) => [s.section, s.summary]));
    const earlier = sections.filter((s) => s.index < r.upTo.section && s.paragraphs.reduce((n, p) => n + count(p), 0) >= MIN_WORDS);
    const current = sections.find((s) => s.index === r.upTo.section);
    return {
      bookId: r.bookId,
      title: book.title,
      author: book.author,
      upTo: r.upTo,
      done: earlier.filter((s) => have.has(s.index)).map((s) => ({ section: s.index, summary: have.get(s.index)! })),
      missing: earlier.filter((s) => !have.has(s.index)).map((s) => ({ section: s.index, text: s.paragraphs.join("\n") })),
      current: (current?.paragraphs ?? []).slice(0, r.upTo.para + 1).map((p, i) => `${label(r.upTo.section, i)} ${p}`),
    };
  },
});

export const saveSummary = internalMutation({
  args: { bookId: v.id("books"), section: v.number(), summary: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("sectionSummaries")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId).eq("section", args.section))
      .unique();
    if (old) await ctx.db.patch(old._id, { summary: args.summary });
    else await ctx.db.insert("sectionSummaries", args);
  },
});

export const store = internalMutation({
  args: { recapId: v.id("recaps"), text: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { recapId, text, error }) => {
    if (!(await ctx.db.get(recapId))) return;
    await ctx.db.patch(recapId, text ? { status: "ready", text } : { status: "error", error });
  },
});

const SUMMARY = `Summarize this section of a book for a reader's memory aid, in 3 to 6 plain sentences:
who appears, what happens, and anything set up for later. Use names. No commentary, no headings.
If it is front or back matter (contents, copyright, acknowledgements), reply with just: -`;

const RECAP = `You write "the story so far" for a reader coming back to a book.
You get summaries of the sections they have finished, then the text of the section they are in, up to where they stopped,
one paragraph per line with labels like [¶12.4].
Write plain Markdown, about 150 to 250 words:
1. One or two short paragraphs: the story (or argument) so far, oldest to newest, with more detail on recent events.
2. A line starting with "**Where you left off:**" describing the last scene or point in 1 or 2 sentences, citing its paragraph label.
3. If the book has characters, "**Who's who:**" followed by up to 5 "- Name: one line" bullets.
Never mention or hint at anything after where the reader stopped.`;

async function summarize(title: string, s: { section: number; text: string }) {
  // Very long sections are trimmed to their opening and close; a summary doesn't need every word.
  const words = s.text.split(/\s+/);
  const text = words.length > 12_000 ? `${words.slice(0, 8_000).join(" ")}\n[…]\n${words.slice(-4_000).join(" ")}` : s.text;
  return chatText(SUMMARY, `Book: ${title}\n\n${text}`, 400);
}

export const build = internalAction({
  args: { recapId: v.id("recaps") },
  handler: async (ctx, { recapId }) => {
    const p = await ctx.runQuery(internal.recaps.plan, { recapId });
    if (!p) return;
    try {
      const done = [...p.done];
      // Summarize the finished sections that don't have one yet, a few at a time.
      for (let i = 0; i < p.missing.length; i += 6) {
        const batch = p.missing.slice(i, i + 6);
        const out = await Promise.all(batch.map((s) => summarize(p.title, s).catch(() => "")));
        for (const [k, summary] of out.entries()) {
          if (!summary) continue;
          const section = batch[k].section;
          await ctx.runMutation(internal.recaps.saveSummary, { bookId: p.bookId as Id<"books">, section, summary });
          done.push({ section, summary });
        }
      }
      done.sort((a, b) => a.section - b.section);
      const finished = done.filter((s) => s.summary.trim() !== "-").map((s) => `Section ${s.section}: ${s.summary}`);
      const text = await chatText(
        RECAP,
        `Book: ${p.title}${p.author ? ` by ${p.author}` : ""}\n\nFinished sections:\n${finished.join("\n\n") || "(none yet)"}\n\nCurrent section so far:\n${p.current.join("\n")}`,
        700,
      );
      if (!text) throw new Error("Empty recap");
      await ctx.runMutation(internal.recaps.store, { recapId, text });
    } catch (e) {
      console.error(e);
      await ctx.runMutation(internal.recaps.store, { recapId, error: "Couldn't write a recap. Try again." });
    }
  },
});
