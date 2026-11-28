import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ownBook } from "./books";
import { DAY } from "./text";
import { STYLE, chatJSON } from "./llm";

const UA = "Loam/0.1 (personal reading app)";

/** Ask for the briefing on a term. It is built in the background the first time and cached. */
export const request = mutation({
  args: { termId: v.id("terms") },
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
      return;
    }
    if (existing) await ctx.db.delete(existing._id);
    const briefId = await ctx.db.insert("briefs", { termId, bookId: term.bookId, status: "pending", ...lookedUp, dueAt: now + DAY, reviewStep: 0 });
    await ctx.scheduler.runAfter(0, internal.briefs.build, { briefId });
  },
});

export const get = query({
  args: { termId: v.id("terms") },
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
  handler: async (ctx, { briefId }) => {
    const brief = await ctx.db.get(briefId);
    const term = brief && (await ctx.db.get(brief.termId));
    const book = term && (await ctx.db.get(term.bookId));
    if (!term || !book) return null;
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

const vData = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  summary: v.string(),
  points: v.array(v.string()),
  context: v.string(),
  image: v.optional(v.string()),
  wikiUrl: v.optional(v.string()),
  video: v.optional(v.object({ id: v.string(), title: v.string() })),
  videoSearch: v.string(),
});

export const store = internalMutation({
  args: { briefId: v.id("briefs"), data: v.optional(vData), error: v.optional(v.string()) },
  handler: async (ctx, { briefId, data, error }) => {
    await ctx.db.patch(briefId, data ? { status: "ready", data } : { status: "error", error });
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
type Wiki = { title: string; description?: string; extract?: string; image?: string; url: string };

async function wikiSummary(title: string): Promise<Wiki | null> {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return null;
  const s = (await res.json()) as {
    type?: string;
    title: string;
    description?: string;
    extract?: string;
    thumbnail?: { source: string };
    content_urls?: { desktop?: { page?: string } };
  };
  if (s.type === "disambiguation") return null;
  return {
    title: s.title,
    description: s.description,
    extract: s.extract,
    image: s.thumbnail?.source,
    url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
  };
}

async function wikiSearch(q: string): Promise<Wiki | null> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return null;
  const hit = ((await res.json()) as { query?: { search?: { title: string }[] } }).query?.search?.[0];
  return hit ? wikiSummary(hit.title) : null;
}

async function youtube(q: string) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return undefined;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&videoEmbeddable=true&safeSearch=moderate&q=${encodeURIComponent(q)}&key=${key}`,
  );
  if (!res.ok) return undefined;
  const item = ((await res.json()) as { items?: { id: { videoId: string }; snippet: { title: string } }[] }).items?.[0];
  return item ? { id: item.id.videoId, title: item.snippet.title } : undefined;
}

/** First couple of sentences, so the panel stays a quick read. */
const brief = (s: string, n = 2) => (s.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [s]).slice(0, n).join("").trim();

export const build = internalAction({
  args: { briefId: v.id("briefs") },
  handler: async (ctx, { briefId }) => {
    const c = await ctx.runQuery(internal.briefs.context, { briefId });
    if (!c) return;
    try {
      const m = await chatJSON<Model>(
        SYSTEM,
        `Book: ${c.title}${c.author ? ` by ${c.author}` : ""}\nTerm: ${c.term}\n\nPassage:\n${c.before}\n\n${c.passage}`,
        900,
      );
      const wiki = (m.wiki ? await wikiSummary(m.wiki) : null) ?? (await wikiSearch(m.title || c.term));
      const videoSearch = m.video || `${m.title || c.term} explained`;
      const video = await youtube(videoSearch);
      await ctx.runMutation(internal.briefs.store, {
        briefId,
        data: {
          title: m.title || wiki?.title || c.term,
          description: wiki?.description,
          summary: wiki?.extract ? brief(wiki.extract) : (m.summary ?? ""),
          points: [],
          context: m.context ?? "",
          image: wiki?.image,
          wikiUrl: wiki?.url,
          video,
          videoSearch,
        },
      });
    } catch (e) {
      console.error(e);
      await ctx.runMutation(internal.briefs.store, { briefId, error: "Couldn't build the briefing." });
    }
  },
});
