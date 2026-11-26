import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./books";
import { DAY, REVIEW_DAYS } from "./text";

/**
 * The daily review: your own highlights and the terms you looked up, back a few at a time,
 * spaced out like flashcards. "Keep" brings one back later each time; "done" retires it.
 */
export const today = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 5 }) => {
    const userId = await requireUser(ctx).catch(() => null);
    if (!userId) return { items: [], due: 0 };
    const now = Date.now();
    const marks = await ctx.db
      .query("marks")
      .withIndex("by_user_due", (q) => q.eq("userId", userId).lte("dueAt", now))
      .take(100);
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_user_due", (q) => q.eq("userId", userId).lte("dueAt", now))
      .take(100);
    type Item =
      | { kind: "mark"; id: string; dueAt: number; bookId: Id<"books">; quote: string; note: string | null; section: number; para: number }
      | { kind: "term"; id: string; dueAt: number; bookId: Id<"books">; term: string; title: string; summary: string; section: number; para: number };
    const items: Item[] = [];
    for (const m of marks) {
      if (m.reviewDone || m.dueAt === undefined) continue;
      items.push({ kind: "mark", id: m._id, dueAt: m.dueAt, bookId: m.bookId, quote: m.quote, note: m.note ?? null, section: m.anchor.section, para: m.anchor.startPara });
    }
    for (const b of briefs) {
      if (b.reviewDone || b.dueAt === undefined || b.status !== "ready" || !b.data) continue;
      const term = await ctx.db.get(b.termId);
      if (!term) continue;
      items.push({ kind: "term", id: b._id, dueAt: b.dueAt, bookId: b.bookId, term: term.term, title: b.data.title, summary: b.data.summary, section: term.section, para: term.para });
    }
    items.sort((a, b) => a.dueAt - b.dueAt);
    const shown = items.slice(0, limit);
    const titles = new Map<string, string>();
    for (const i of shown) if (!titles.has(i.bookId)) titles.set(i.bookId, (await ctx.db.get(i.bookId))?.title ?? "");
    return { items: shown.map((i) => ({ ...i, bookTitle: titles.get(i.bookId) ?? "" })), due: items.length };
  },
});

const vItem = { kind: v.union(v.literal("mark"), v.literal("term")), id: v.string() };

async function load(ctx: Parameters<typeof requireUser>[0], kind: "mark" | "term", id: string) {
  const userId = await requireUser(ctx);
  const table = kind === "mark" ? "marks" : "briefs";
  const docId = ctx.db.normalizeId(table, id);
  const doc = docId && (await ctx.db.get(docId));
  if (!doc || doc.userId !== userId) throw new Error("Not found");
  return doc;
}

/** Seen and kept: it comes back later, a little later each time. */
export const keep = mutation({
  args: vItem,
  handler: async (ctx, { kind, id }) => {
    const doc = await load(ctx, kind, id);
    const step = (doc.reviewStep ?? 0) + 1;
    const days = REVIEW_DAYS[Math.min(step - 1, REVIEW_DAYS.length - 1)];
    await ctx.db.patch(doc._id, { reviewStep: step, dueAt: Date.now() + days * DAY });
  },
});

/** Seen and done with: it stays in the notebook but leaves the review. */
export const done = mutation({
  args: vItem,
  handler: async (ctx, { kind, id }) => {
    const doc = await load(ctx, kind, id);
    await ctx.db.patch(doc._id, { reviewDone: true });
  },
});
