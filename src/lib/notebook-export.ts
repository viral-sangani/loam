import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { plainAnswer } from "@/components/reader/answer";
import { anchorStart, comparePos, type Pos } from "./anchors";

/** What `api.notebook.get` returns once loaded. */
export type NotebookData = NonNullable<FunctionReturnType<typeof api.notebook.get>>;
export type NotebookMark = NotebookData["marks"][number];
export type NotebookAsk = NotebookData["asks"][number];
export type NotebookLookup = NotebookData["lookups"][number];

export type NotebookEntry =
  | { kind: "mark"; key: string; pos: Pos; word: number; at: number; mark: NotebookMark }
  | { kind: "ask"; key: string; pos: Pos; word: number; at: number; ask: NotebookAsk }
  | { kind: "term"; key: string; pos: Pos; word: number; at: number; lookup: NotebookLookup };

/** An ask with neither a passage nor a position can't be placed; it goes last rather than vanishing. */
const NOWHERE: Pos = { section: Number.MAX_SAFE_INTEGER, para: 0 };

/** Everything in the notebook in reading order; ties (same paragraph) by word, then by when it was made. */
export function notebookEntries(data: NotebookData): NotebookEntry[] {
  const entries: NotebookEntry[] = [
    ...data.marks.map((mark) => ({
      kind: "mark" as const,
      key: mark._id,
      pos: anchorStart(mark.anchor),
      word: mark.anchor.startWord,
      at: mark.createdAt,
      mark,
    })),
    ...data.asks.map((ask) => ({
      kind: "ask" as const,
      key: ask._id,
      pos: ask.anchor ? anchorStart(ask.anchor) : (ask.position ?? NOWHERE),
      // A book question is about everything before its position, so it sorts after that paragraph's marks.
      word: ask.anchor?.startWord ?? Number.MAX_SAFE_INTEGER,
      at: ask.createdAt,
      ask,
    })),
    ...data.lookups.map((lookup) => ({
      kind: "term" as const,
      key: lookup._id,
      pos: { section: lookup.section, para: lookup.para },
      word: 0,
      at: lookup.lookedUpAt,
      lookup,
    })),
  ];
  return entries.sort((a, b) => comparePos(a.pos, b.pos) || a.word - b.word || a.at - b.at);
}

/** A table-of-contents entry, as far as chapter labels need one. */
export type TocItem = { label: string; spine: number };

/**
 * A label for a spine section: its own contents entry, or else the chapter it continues
 * (books often split a chapter over several files). Without a contents list, a plain number.
 */
export function chapterLabel(toc: readonly TocItem[] | undefined, section: number): string {
  let best: TocItem | undefined;
  for (const t of toc ?? []) if (t.spine <= section && (!best || t.spine > best.spine)) best = t;
  return best?.label || `Chapter ${section}`;
}

const quoteBlock = (s: string) =>
  s
    .trim()
    .split(/\n+/)
    .map((l) => `> ${l.trim()}`)
    .join("\n>\n");

function entryMarkdown(e: NotebookEntry): string {
  if (e.kind === "mark") {
    const { quote, note } = e.mark;
    return [quoteBlock(quote), note?.trim()].filter(Boolean).join("\n\n");
  }
  if (e.kind === "ask") {
    const { quote, question, status, answer } = e.ask;
    const a = status === "ready" && answer ? plainAnswer(answer).trim() : "*(No answer yet.)*";
    return [quote && quoteBlock(quote), `**Q:** ${question.trim()}`, a].filter(Boolean).join("\n\n");
  }
  const { title, term, summary, context } = e.lookup;
  const name = title.trim().toLowerCase() === term.trim().toLowerCase() ? `**${title}**` : `**${title}** (${term})`;
  return [`${name}: ${summary.trim()}`, context?.trim() && `*In this passage:* ${context.trim()}`].filter(Boolean).join("\n\n");
}

/** The notebook as Markdown that drops straight into Obsidian or any notes app. */
export function notebookMarkdown(data: NotebookData, toc?: readonly TocItem[]): string {
  const out = [`# ${data.title}`];
  if (data.author) out.push(`*${data.author}*`);
  let chapter: string | null = null;
  for (const e of notebookEntries(data)) {
    const label = e.pos === NOWHERE ? "Other questions" : chapterLabel(toc, e.pos.section);
    if (label !== chapter) {
      out.push(`## ${label}`);
      chapter = label;
    }
    out.push(entryMarkdown(e));
  }
  return `${out.join("\n\n")}\n`;
}

/** A safe file name for the exported notebook. */
export const notebookFileName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Notebook"} notes.md`;
