import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ownBook } from "./books";
import { DAY } from "./text";
import { STYLE, chatJSON } from "./llm";
import { vBriefData, vTermExplanation } from "./schema";

const UA = "Loam/0.1 (personal reading app)";

function textBrief({ title, summary, context }: Infer<typeof vTermExplanation>, videoSearch = `${title} explained`) {
  return { title, summary, context, points: [], videoSearch };
}

/** Ask for the briefing on a term. It is built in the background the first time and cached. */
export const request = mutation({
  args: { termId: v.id("terms") },
  returns: v.null(),
  handler: async (ctx, { termId }) => {
    const term = await ctx.db.get(termId);
    if (!term) throw new Error("Term not found");
    const book = await ownBook(ctx, term.bookId);
    const existing = await ctx.db
      .query("briefs")
      .withIndex("by_term", (q) => q.eq("termId", termId))
      .unique();
    const now = Date.now();
    // Looking a term up puts it in the notebook, and in the daily review from tomorrow.
    const lookedUp = { userId: book.userId, lookedUpAt: now, ...(existing?.dueAt ? {} : { dueAt: now + DAY, reviewStep: 0 }) };
    if (existing && existing.status !== "error") {
      await ctx.db.patch(existing._id, lookedUp);
      if (!term.explanation && existing.data?.summary) {
        const { title, summary, context } = existing.data;
        await ctx.db.patch(term._id, { explanation: { title, summary, context } });
      }
      return null;
    }
    if (existing) await ctx.db.delete(existing._id);
    const data = term.explanation && textBrief(term.explanation);
    const briefId = await ctx.db.insert("briefs", {
      termId, bookId: term.bookId, ...lookedUp, dueAt: now + DAY, reviewStep: 0,
      ...(data ? { status: "ready", data } : { status: "pending" }),
    });
    await ctx.scheduler.runAfter(0, internal.briefs.build, { briefId });
    return null;
  },
});

export const get = query({
  args: { termId: v.id("terms") },
  returns: v.union(v.null(), v.object({
    term: v.string(),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("error")),
    error: v.optional(v.string()),
    data: v.optional(vBriefData),
  })),
  handler: async (ctx, { termId }) => {
    const term = await ctx.db.get(termId);
    if (!term) return null;
    await ownBook(ctx, term.bookId);
    const brief = await ctx.db
      .query("briefs")
      .withIndex("by_term", (q) => q.eq("termId", termId))
      .unique();
    return { term: term.term, status: brief?.status ?? "pending", error: brief?.error, data: brief?.data };
  },
});

export const context = internalQuery({
  args: { briefId: v.id("briefs") },
  returns: v.union(v.null(), v.object({
    term: v.string(),
    explanation: vTermExplanation,
  }), v.object({
    term: v.string(), title: v.string(), author: v.string(), before: v.string(), passage: v.string(),
  })),
  handler: async (ctx, { briefId }) => {
    const brief = await ctx.db.get(briefId);
    const term = brief && (await ctx.db.get(brief.termId));
    const book = term && (await ctx.db.get(term.bookId));
    if (!term || !book) return null;
    if (term.explanation) return { term: term.term, explanation: term.explanation };
    const section = await ctx.db
      .query("sections")
      .withIndex("by_book", (q) => q.eq("bookId", term.bookId).eq("index", term.section))
      .unique();
    const paras = section?.paragraphs ?? [];
    return {
      term: term.term,
      title: book.title,
      author: book.author,
      before: paras[term.para - 1] ?? "",
      passage: paras[term.para] ?? "",
    };
  },
});

export const store = internalMutation({
  args: { briefId: v.id("briefs"), data: v.optional(vBriefData), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { briefId, data, error }) => {
    const row = await ctx.db.get(briefId);
    if (!row) return null;
    if (data) {
      await ctx.db.patch(briefId, { status: "ready", data, error: undefined });
      const term = await ctx.db.get(row.termId);
      if (term && !term.explanation) {
        const { title, summary, context } = data;
        await ctx.db.patch(term._id, { explanation: { title, summary, context } });
      }
    } else if (row.status === "pending") {
      await ctx.db.patch(briefId, { status: "error", error });
    }
    return null;
  },
});

const SYSTEM = `You write quick briefings for a reader who just tapped a term while reading a book.
Reply with JSON only:
{"title":"<the term's proper name>",
 "wiki":"<exact title of the English Wikipedia article about it, or empty string if none>",
 "summary":"<2 plain-language sentences on what it is>",
 "context":"<1 sentence on what it refers to in this passage. Don't comment on its significance.>",
 "video":"<a YouTube search query for a short explainer video about it>"}
For the text fields: ${STYLE}`;

type Model = { title?: string; wiki?: string; summary?: string; context?: string; video?: string };
type Wiki = { description?: string; image?: string; url: string };

async function wikiSummary(title: string, signal: AbortSignal): Promise<Wiki | null> {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`,
    { headers: { "User-Agent": UA }, signal },
  );
  if (!res.ok) return null;
  const s = (await res.json()) as {
    type?: string;
    title: string;
    description?: string;
    thumbnail?: { source: string };
    content_urls?: { desktop?: { page?: string } };
  };
  if (s.type === "disambiguation") return null;
  return {
    description: s.description,
    image: s.thumbnail?.source,
    url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
  };
}

async function wikiSearch(q: string, signal: AbortSignal): Promise<Wiki | null> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": UA }, signal },
  );
  if (!res.ok) return null;
  const hit = ((await res.json()) as { query?: { search?: { title: string }[] } }).query?.search?.[0];
  return hit ? wikiSummary(hit.title, signal) : null;
}

async function youtube(q: string, signal: AbortSignal) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return undefined;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&videoEmbeddable=true&safeSearch=moderate&q=${encodeURIComponent(q)}&key=${key}`,
    { signal },
  );
  if (!res.ok) return undefined;
  const item = ((await res.json()) as { items?: { id: { videoId: string }; snippet: { title: string } }[] }).items?.[0];
  return item ? { id: item.id.videoId, title: item.snippet.title } : undefined;
}

export const build = internalAction({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, { briefId }) => {
    const c = await ctx.runQuery(internal.briefs.context, { briefId });
    if (!c) return null;

    let explanation = c.explanation;
    let videoSearch: string | undefined;
    if (!explanation) {
      try {
        const m = await chatJSON<Model>(
          SYSTEM,
          `Book: ${c.title}${c.author ? ` by ${c.author}` : ""}\nTerm: ${c.term}\n\nPassage:\n${c.before}\n\n${c.passage}`,
          900,
          AbortSignal.timeout(20_000),
        );
        const summary = m.summary?.trim();
        if (!summary) throw new Error("Missing term explanation");
        explanation = { title: m.title || c.term, summary, context: m.context ?? "", wiki: m.wiki };
        videoSearch = m.video;
        // Publish the text before either optional source starts.
        await ctx.runMutation(internal.briefs.store, { briefId, data: textBrief(explanation, videoSearch) });
      } catch (e) {
        console.error(e);
        await ctx.runMutation(internal.briefs.store, { briefId, error: "Couldn't build the briefing." });
        return null;
      }
    }

    const data = textBrief(explanation, videoSearch);
    const signal = AbortSignal.timeout(5000);
    const wikiPage = explanation.wiki ? wikiSummary(explanation.wiki, signal) : Promise.resolve(null);
    const [wiki, video] = await Promise.all([
      wikiPage.then((page) => page ?? wikiSearch(data.title, signal)).catch(() => null),
      youtube(data.videoSearch, signal).catch(() => undefined),
    ]);
    if (wiki || video) {
      await ctx.runMutation(internal.briefs.store, {
        briefId,
        data: { ...data, description: wiki?.description, image: wiki?.image, wikiUrl: wiki?.url, video },
      });
    }
    return null;
  },
});
