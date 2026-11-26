import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ownBook } from "./books";
import { chatText } from "./llm";
import { vAnchor, vPos } from "./schema";
import { paragraphsOf, quoteOf, textBefore } from "./text";

/** One-click questions on a selection, and how each reads in the notebook. */
const QUESTIONS = {
  explain: "What does this mean here?",
  define: "What does this word mean here?",
  simplify: "Can you say it more simply?",
} as const;

const TASK: Record<"explain" | "define" | "simplify" | "ask" | "book", string> = {
  explain: "Explain what the selected passage means here, and why it is here in the book. 2 short paragraphs at most.",
  define: "Define the selected word or phrase as this author uses it here, in 1 to 3 sentences. Mention a plainer synonym if there is one.",
  simplify: "Say the same thing as the selected passage in plain, modern words. Keep it about as long as the original.",
  ask: "Answer the reader's question about the selected passage.",
  book: "Answer the reader's question about the book so far.",
};

const SYSTEM = `You are a reading companion inside an e-book reader. You get the book's text up to where the reader is,
one paragraph per line, each starting with a label like [¶12.4] (section 12, paragraph 4).
Rules:
- Answer from the text. Cite the paragraphs you rely on with their labels exactly, e.g. [¶12.4], right after the claim. Use general knowledge only to explain words, history and references, never to tell what happens later.
- Never reveal, hint at or speculate about anything after the reader's position: no spoilers. If the answer depends on what comes later, say it isn't clear yet.
- Be brief and concrete. Plain Markdown only: short paragraphs, "- " lists if needed, **bold** sparingly. No headings.
- Wrap the single most important sentence of your answer in ==double equals== once, so a skimmer can stop there.`;

export const list = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    await ownBook(ctx, bookId);
    const rows = await ctx.db
      .query("asks")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return rows.map(({ _creationTime, userId, bookId, ...a }) => a); // eslint-disable-line @typescript-eslint/no-unused-vars
  },
});

export const get = query({
  args: { askId: v.id("asks") },
  handler: async (ctx, { askId }) => {
    const a = await ctx.db.get(askId);
    if (!a) return null;
    await ownBook(ctx, a.bookId);
    return a;
  },
});

/**
 * Ask about a selected passage (`anchor`, with `kind` explain/define/simplify/ask) or about the
 * whole book up to `position` (`kind: "book"`). Answered in the background; returns the ask's id.
 */
export const create = mutation({
  args: {
    bookId: v.id("books"),
    kind: v.union(v.literal("explain"), v.literal("define"), v.literal("simplify"), v.literal("ask"), v.literal("book")),
    question: v.optional(v.string()),
    anchor: v.optional(vAnchor),
    position: v.optional(vPos),
  },
  handler: async (ctx, { bookId, kind, question, anchor, position }) => {
    const book = await ownBook(ctx, bookId);
    let quote: string | undefined;
    if (kind === "book") {
      if (!position) throw new ConvexError("Missing reading position");
      if (!question?.trim()) throw new ConvexError("Missing question");
    } else {
      if (!anchor) throw new ConvexError("Missing selection");
      if (kind === "ask" && !question?.trim()) throw new ConvexError("Missing question");
      const s = await ctx.db
        .query("sections")
        .withIndex("by_book", (q) => q.eq("bookId", bookId).eq("index", anchor.section))
        .unique();
      quote = s ? quoteOf(s.paragraphs, anchor).slice(0, 4000) : undefined;
      if (!quote) throw new ConvexError("Nothing selected");
    }
    const askId = await ctx.db.insert("asks", {
      bookId,
      userId: book.userId,
      kind,
      question: (kind === "ask" || kind === "book" ? question!.trim() : QUESTIONS[kind]).slice(0, 1000),
      anchor: kind === "book" ? undefined : anchor,
      quote,
      position: kind === "book" ? position : undefined,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.asks.answer, { askId });
    return askId;
  },
});

export const retry = mutation({
  args: { askId: v.id("asks") },
  handler: async (ctx, { askId }) => {
    const a = await ctx.db.get(askId);
    if (!a) return;
    await ownBook(ctx, a.bookId);
    await ctx.db.patch(askId, { status: "pending", error: undefined });
    await ctx.scheduler.runAfter(0, internal.asks.answer, { askId });
  },
});

export const remove = mutation({
  args: { askId: v.id("asks") },
  handler: async (ctx, { askId }) => {
    const a = await ctx.db.get(askId);
    if (!a) return;
    await ownBook(ctx, a.bookId);
    await ctx.db.delete(askId);
  },
});

export const prompt = internalQuery({
  args: { askId: v.id("asks") },
  handler: async (ctx, { askId }) => {
    const a = await ctx.db.get(askId);
    const book = a && (await ctx.db.get(a.bookId));
    if (!a || !book) return null;
    const head = `Book: ${book.title}${book.author ? ` by ${book.author}` : ""}`;
    if (a.kind === "book") {
      const { text, truncated } = await textBefore(ctx, a.bookId, a.position!, 60_000);
      return {
        user: `${head}\n${truncated ? "(Earlier text omitted.)\n" : ""}\n${text}\n\nThe reader is at ${`[¶${a.position!.section}.${a.position!.para}]`}.\nTask: ${TASK.book}\nQuestion: ${a.question}`,
      };
    }
    const an = a.anchor!;
    const before = await textBefore(ctx, a.bookId, { section: an.section, para: an.startPara - 1 }, 3_000);
    const around = await paragraphsOf(ctx, a.bookId, an.section, an.startPara, an.endPara + 2);
    return {
      user: `${head}\n\n${before.text}\n${around.text}\n\nSelected passage (from [¶${an.section}.${an.startPara}]): "${a.quote}"\nTask: ${TASK[a.kind]}${a.kind === "ask" ? `\nQuestion: ${a.question}` : ""}`,
    };
  },
});

export const store = internalMutation({
  args: { askId: v.id("asks"), answer: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { askId, answer, error }) => {
    if (!(await ctx.db.get(askId))) return;
    await ctx.db.patch(askId, answer ? { status: "ready", answer } : { status: "error", error });
  },
});

export const answer = internalAction({
  args: { askId: v.id("asks") },
  handler: async (ctx, { askId }) => {
    const p = await ctx.runQuery(internal.asks.prompt, { askId });
    if (!p) return;
    try {
      const answer = await chatText(SYSTEM, p.user, 900);
      if (!answer) throw new Error("Empty answer");
      await ctx.runMutation(internal.asks.store, { askId, answer });
    } catch (e) {
      console.error(e);
      await ctx.runMutation(internal.asks.store, { askId, error: "Couldn't get an answer. Try again." });
    }
  },
});
