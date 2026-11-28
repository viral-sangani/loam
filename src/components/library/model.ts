import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

/** A book as `books.list` returns it. */
export type ListedBook = Omit<FunctionReturnType<typeof api.books.list>[number], "epub"> & { epub: string };
/** Counts from `books.extras`. */
export type Extras = FunctionReturnType<typeof api.books.extras>;

export type AudioState =
  | { kind: "none" }
  | { kind: "uploading"; pct: number }
  | { kind: "queued" }
  | { kind: "syncing"; pct: number }
  | { kind: "ready"; coverage: number | null; durationMs: number | null }
  | { kind: "error" };

/** One paragraph of the opening, split into words, with the words Loam can explain marked. */
export type PreviewPara = { section: number; para: number; words: string[]; marked: boolean[] };

export function audioState(book: ListedBook, uploading: number | null): AudioState {
  if (uploading !== null) return { kind: "uploading", pct: Math.round(uploading * 100) };
  const a = book.audio;
  if (!a) return { kind: "none" };
  if (a.status === "ready") return { kind: "ready", coverage: a.coverage, durationMs: a.durationMs };
  if (a.status === "error") return { kind: "error" };
  if (a.status === "queued") return { kind: "queued" };
  return { kind: "syncing", pct: Math.round(a.progress * 100) };
}

/** "6 h 12 m", "42 m". */
export function duration(ms: number | null) {
  if (!ms) return null;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} m`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;

const percentOf = (b: ListedBook) => b.progress?.percent ?? null;
const finished = (b: ListedBook) => (percentOf(b) ?? 0) >= 0.995;

/** "Chapter 4 · 38%", "Not started". */
export function progressLabel(b: ListedBook) {
  if (!b.progress) return "Not started";
  if (finished(b)) return "Finished";
  const p = percentOf(b);
  const parts = [b.progress.chapter, p !== null ? pct(p) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Started";
}

/** The audiobook's state in a few words, or null when there is none. */
export function audioLabel(a: AudioState) {
  switch (a.kind) {
    case "none":
      return null;
    case "uploading":
      return `Uploading audio ${a.pct}%`;
    case "queued":
      return "Audio waiting to sync";
    case "syncing":
      return `Syncing audio ${a.pct}%`;
    case "ready":
      return ["Audiobook", duration(a.durationMs)].filter(Boolean).join(" · ");
    case "error":
      return "Audio sync failed";
  }
}

/** The term pass's state, or null once it is done. */
export function termsLabel(b: ListedBook) {
  const t = b.terms;
  if (t.status === "done") return null;
  if (t.status === "error") return "Finding terms failed";
  if (t.status === "running") return `Finding terms ${t.total ? Math.round((t.done / t.total) * 100) : 0}%`;
  return "Terms waiting";
}

export const readHref = (id: string, listen = false) => `/read/${id}${listen ? "?listen=1" : ""}`;
