import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

/** A book as `books.list` returns it. */
export type ListedBook = FunctionReturnType<typeof api.books.list>[number];
/** Counts from `books.extras`. */
export type Extras = FunctionReturnType<typeof api.books.extras>;

export type AudioState =
  | { kind: "none" }
  | { kind: "uploading"; pct: number }
  | { kind: "queued" }
  | { kind: "syncing"; pct: number }
  | { kind: "ready"; coverage: number | null; durationMs: number | null }
  | { kind: "error" };

export type AiState =
  | { kind: "waiting" }
  | { kind: "running"; pct: number }
  | { kind: "done"; terms: number | null }
  | { kind: "error" };

/** One paragraph of the opening, split into words, with the words Loam can explain marked. */
export type PreviewPara = { section: number; para: number; words: string[]; marked: boolean[] };

/** Everything the room and the list draw for one book. */
export type ShelfBook = {
  id: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  addedAt: number;
  /** 0..1, or null when the reader hasn't reported a percentage yet. */
  percent: number | null;
  started: boolean;
  chapter: string | null;
  audio: AudioState;
  ai: AiState;
  extras: Extras | null;
  /** Cloth colours for books without a cover (and spines). */
  cloth: Cloth;
  /** Size in metres: width, height, thickness. */
  size: { W: number; H: number; T: number };
};

export type Cloth = { cloth: string; foil: string };

export function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Bookcloth colours with a foil that reads on each. */
const CLOTHS: Cloth[] = [
  { cloth: "#1d2738", foil: "#d6b06a" },
  { cloth: "#22344b", foil: "#d6b06a" },
  { cloth: "#5a1c22", foil: "#d6b06a" },
  { cloth: "#4d664b", foil: "#e3cf9a" },
  { cloth: "#3b2a4a", foil: "#d9bd7f" },
  { cloth: "#6b4a2c", foil: "#ecd9a8" },
  { cloth: "#2f4732", foil: "#d6b06a" },
  { cloth: "#7a2731", foil: "#e3cf9a" },
  { cloth: "#2c3e3a", foil: "#d9bd7f" },
  { cloth: "#4a3320", foil: "#e3cf9a" },
];

export const clothFor = (id: string): Cloth => CLOTHS[hash(id) % CLOTHS.length];

export function sizeFor(id: string, wordCount: number) {
  const h = hash(id + ":size");
  const W = 0.226 + ((h % 1000) / 1000) * 0.026;
  const H = W * (1.44 + (((h >>> 10) % 1000) / 1000) * 0.08);
  // Roughly 0.03 m per 100k words, kept within what looks like a book.
  const T = Math.min(0.085, Math.max(0.026, 0.024 + (wordCount / 100_000) * 0.032));
  return { W, H, T };
}

export function audioState(book: ListedBook, uploading: number | null): AudioState {
  if (uploading !== null) return { kind: "uploading", pct: Math.round(uploading * 100) };
  const a = book.audio;
  if (!a) return { kind: "none" };
  if (a.status === "ready") return { kind: "ready", coverage: a.coverage, durationMs: a.durationMs };
  if (a.status === "error") return { kind: "error" };
  if (a.status === "queued") return { kind: "queued" };
  return { kind: "syncing", pct: Math.round(a.progress * 100) };
}

export function aiState(book: ListedBook, extras: Extras | null): AiState {
  const t = book.terms;
  if (t.status === "done") return { kind: "done", terms: extras ? extras.terms : null };
  if (t.status === "error") return { kind: "error" };
  if (t.status === "running") return { kind: "running", pct: t.total ? Math.round((t.done / t.total) * 100) : 0 };
  return { kind: "waiting" };
}

export function toShelfBook(book: ListedBook, uploading: number | null, extras: Extras | null): ShelfBook {
  return {
    id: book._id,
    title: book.title || "Untitled",
    author: book.author,
    description: book.description,
    coverUrl: book.coverUrl,
    addedAt: book.addedAt,
    percent: book.progress?.percent ?? null,
    started: !!book.progress,
    chapter: book.progress?.chapter ?? null,
    audio: audioState(book, uploading),
    ai: aiState(book, extras),
    extras,
    cloth: clothFor(book._id),
    size: sizeFor(book._id, book.wordCount),
  };
}

/** "6 h 12 m", "42 m". */
export function duration(ms: number | null) {
  if (!ms) return null;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} m`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const finished = (b: ShelfBook) => b.percent !== null && b.percent >= 0.995;

/** The main action's label. */
export function readLabel(b: ShelfBook) {
  if (finished(b)) return "Read again";
  return b.started ? "Continue" : "Start reading";
}

/** "Chapter 4 · 38%", "Not started". */
export function progressLabel(b: ShelfBook) {
  if (!b.started) return "Not started";
  if (finished(b)) return "Finished";
  const parts = [b.chapter, b.percent !== null ? pct(b.percent) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Started";
}

export function audioLabel(a: AudioState) {
  switch (a.kind) {
    case "none":
      return "No audiobook";
    case "uploading":
      return `Uploading audio ${a.pct}%`;
    case "queued":
      return "Audio waiting to sync";
    case "syncing":
      return `Syncing audio ${a.pct}%`;
    case "ready":
      return ["Audio synced", duration(a.durationMs)].filter(Boolean).join(" · ");
    case "error":
      return "Audio sync failed";
  }
}

export function aiLabel(a: AiState) {
  switch (a.kind) {
    case "waiting":
      return "Terms waiting";
    case "running":
      return `Finding terms ${a.pct}%`;
    case "done":
      return a.terms === null ? "Terms marked" : a.terms === 1 ? "1 term" : `${a.terms} terms`;
    case "error":
      return "Term pass failed";
  }
}

/** One line for hover cards and the screen-reader summary. */
export function statusLine(b: ShelfBook) {
  const parts = [progressLabel(b)];
  if (b.audio.kind !== "none") parts.push(audioLabel(b.audio));
  parts.push(aiLabel(b.ai));
  return parts.join(" · ");
}

export const addedLabel = (ms: number) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(ms);
