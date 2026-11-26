import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { chatJSON } from "./llm";

/** Sections shorter than this (title pages, copyright, dedications) are skipped. */
const MIN_WORDS = 60;
/** Paragraphs are sent to the model in batches of about this many words. */
const CHUNK_WORDS = 1500;

const SYSTEM = `You annotate books for curious readers. You get numbered paragraphs from a book.
Pick the words or short phrases a thoughtful reader might want to look up: real people, places,
historical events, organizations, works of art or literature, scientific and technical concepts,
foreign or archaic words, and cultural references.
Skip everyday words, invented names of fictional characters and places, and anything obvious from context.
Pick only terms genuinely worth a look, at most one per 50 words. Never repeat a term, and skip terms already annotated earlier.
Copy each term exactly as it appears in its paragraph, 1 to 5 words.
Reply with JSON only: {"terms":[{"p":<paragraph number>,"t":"<exact text>"}]}.
Reply {"terms":[]} for front or back matter (copyright pages, contents, acknowledgements) or when nothing qualifies.`;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export const start = internalMutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    const total = sections.filter((s) => s.paragraphs.reduce((n, p) => n + words(p), 0) >= MIN_WORDS).length;
    await ctx.db.patch(bookId, { terms: { status: total ? "running" : "done", done: 0, total } });
    if (total) await ctx.scheduler.runAfter(0, internal.terms.run, { bookId, after: -1 });
  },
});

export const nextSection = internalQuery({
  args: { bookId: v.id("books"), after: v.number() },
  handler: async (ctx, { bookId, after }) => {
    const book = await ctx.db.get(bookId);
    if (!book) return null;
    const rows = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", bookId).gt("index", after))
      .take(50);
    const section = rows.find((s) => s.paragraphs.reduce((n, p) => n + words(p), 0) >= MIN_WORDS) ?? null;
    const known = await ctx.db
      .query("terms")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    return { section, title: book.title, author: book.author, known: known.map((t) => t.term) };
  },
});

export const save = internalMutation({
  args: {
    bookId: v.id("books"),
    section: v.number(),
    terms: v.array(v.object({ para: v.number(), term: v.string() })),
    error: v.optional(v.string()),
    last: v.boolean(),
  },
  handler: async (ctx, { bookId, section, terms, error, last }) => {
    const book = await ctx.db.get(bookId);
    if (!book) return;
    for (const t of terms) await ctx.db.insert("terms", { bookId, section, ...t });
    const done = book.terms.done + 1;
    await ctx.db.patch(bookId, {
      terms: {
        status: last ? "done" : "running",
        done,
        total: Math.max(book.terms.total, done),
        ...(error ? { error } : book.terms.error ? { error: book.terms.error } : {}),
      },
    });
  },
});

/** Processes one section, then schedules the next, so the whole book runs in the background. */
export const run = internalAction({
  args: { bookId: v.id("books"), after: v.number() },
  handler: async (ctx, { bookId, after }) => {
    const next = await ctx.runQuery(internal.terms.nextSection, { bookId, after });
    if (!next) return; // book was deleted
    const { section, title, author } = next;
    if (!section) {
      // Nothing left: make sure the status says so even if the last section was skipped.
      await ctx.runMutation(internal.terms.finish, { bookId });
      return;
    }

    const known = new Set(next.known.map((t) => t.toLowerCase()));
    const found: { para: number; term: string }[] = [];
    let error: string | undefined;

    // Batch paragraphs into chunks of about CHUNK_WORDS words.
    const chunks: number[][] = [[]];
    let count = 0;
    section.paragraphs.forEach((p, i) => {
      if (count > CHUNK_WORDS) {
        chunks.push([]);
        count = 0;
      }
      chunks[chunks.length - 1].push(i);
      count += words(p);
    });

    for (const chunk of chunks) {
      const numbered = chunk.map((pi, n) => `[${n + 1}] ${section.paragraphs[pi]}`).join("\n\n");
      const recent = [...known].slice(-150).join(", ");
      try {
        const out = await chatJSON<{ terms?: { p?: number; t?: string }[] }>(
          SYSTEM,
          `Book: ${title}${author ? ` by ${author}` : ""}\nAlready annotated earlier: ${recent || "none"}\n\n${numbered}`,
        );
        for (const { p, t } of out.terms ?? []) {
          const pi = typeof p === "number" ? chunk[p - 1] : undefined;
          const term = t?.trim();
          if (pi === undefined || !term || known.has(term.toLowerCase())) continue;
          // Only keep terms that really appear in their paragraph, so the reader can underline them.
          if (!section.paragraphs[pi].toLowerCase().includes(term.toLowerCase())) continue;
          known.add(term.toLowerCase());
          found.push({ para: pi, term });
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    const more = await ctx.runQuery(internal.terms.nextSection, { bookId, after: section.index });
    const last = !more?.section;
    await ctx.runMutation(internal.terms.save, { bookId, section: section.index, terms: found, error, last });
    if (!last) await ctx.scheduler.runAfter(0, internal.terms.run, { bookId, after: section.index });
  },
});

export const finish = internalMutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const book = await ctx.db.get(bookId);
    if (book) await ctx.db.patch(bookId, { terms: { ...book.terms, status: "done", done: book.terms.total } });
  },
});
