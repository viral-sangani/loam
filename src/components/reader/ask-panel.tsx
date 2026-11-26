"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Anchor, Pos } from "@/lib/anchors";
import { Answer } from "./answer";
import { keepKeys, type AskKind } from "./lens";
import { Sheet } from "./sheet";

/** A stretch of the book being asked about. */
export type Passage = { anchor: Anchor; quote: string };

/** How each one-tap question reads (the backend stores the same wording). */
const QUESTION: Record<Exclude<AskKind, "ask">, string> = {
  explain: "What does this mean here?",
  define: "What does this word mean here?",
  simplify: "Can you say it more simply?",
};

const TITLE: Record<AskKind, string> = { explain: "Explain", define: "Define", simplify: "In plain words", ask: "Ask" };

type Entry = { key: number; kind: AskKind; question: string; id: Id<"asks"> | null; failed: boolean };
type Thread = { passage: Passage; entries: Entry[] };

/**
 * Questions about one passage: the first (Explain, Define, Simplify or Ask) and any follow-ups,
 * each a separate ask on the same anchor, answered in the background.
 */
export function useAskThread(bookId: Id<"books">) {
  const create = useMutation(api.asks.create);
  const [thread, setThread] = useState<Thread | null>(null);
  const nextKey = useRef(0);

  const patch = useCallback((key: number, p: Partial<Entry>) => {
    setThread((t) => t && { ...t, entries: t.entries.map((e) => (e.key === key ? { ...e, ...p } : e)) });
  }, []);

  const send = useCallback(
    (passage: Passage, kind: AskKind, question: string | undefined, key: number) => {
      create({ bookId, kind, anchor: passage.anchor, question })
        .then((id) => patch(key, { id, failed: false }))
        .catch(() => patch(key, { failed: true }));
    },
    [create, bookId, patch],
  );

  const entry = (kind: AskKind, question?: string): Entry => ({
    key: nextKey.current++,
    kind,
    question: kind === "ask" ? question!.trim() : QUESTION[kind],
    id: null,
    failed: false,
  });

  /** Ask a first question about a passage, starting a new thread. */
  const start = (passage: Passage, kind: AskKind, question?: string) => {
    const e = entry(kind, question);
    setThread({ passage, entries: [e] });
    send(passage, kind, question, e.key);
  };

  /** Ask another question about the same passage. */
  const followUp = (question: string) => {
    if (!thread) return;
    const e = entry("ask", question);
    setThread({ ...thread, entries: [...thread.entries, e] });
    send(thread.passage, "ask", question, e.key);
  };

  /** Send again a question whose request never reached the server. */
  const resend = (e: Entry) => {
    if (!thread) return;
    patch(e.key, { failed: false });
    send(thread.passage, e.kind, e.question, e.key);
  };

  const drop = (key: number) => setThread((t) => t && { ...t, entries: t.entries.filter((e) => e.key !== key) });

  return { thread, start, followUp, resend, drop };
}

export type AskThread = ReturnType<typeof useAskThread>;

/** The side panel with the answers about a passage, and a line to ask a follow-up. */
export function AskPanel({ asks, onCite, onClose }: { asks: AskThread; onCite: (pos: Pos) => void; onClose: () => void }) {
  const { thread } = asks;
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const count = thread?.entries.length ?? 0;

  // Bring a new follow-up into view.
  useEffect(() => {
    if (count > 1) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count]);

  if (!thread) return null;
  const first = thread.entries[0];

  return (
    <Sheet title={first ? TITLE[first.kind] : "About this passage"} variant="side" onClose={onClose}>
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-6">
        <blockquote className="line-clamp-6 border-l-2 border-primary/40 pl-3 font-serif text-[15px] leading-relaxed text-foreground/80">
          {thread.passage.quote}
        </blockquote>
        {thread.entries.map((e) => (
          <AskEntry
            key={e.key}
            entry={e}
            onCite={onCite}
            onResend={() => asks.resend(e)}
            onDelete={() => {
              asks.drop(e.key);
              if (thread.entries.length === 1) onClose();
            }}
          />
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          asks.followUp(draft);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => keepKeys(e, onClose)}
          maxLength={1000}
          placeholder="Ask a follow-up about this passage"
          aria-label="Follow-up question"
          className="h-9 min-w-0 flex-1 rounded-xl bg-secondary/70 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:h-11 pointer-coarse:text-base"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={!draft.trim()}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-4"
        >
          <ArrowUp />
        </button>
      </form>
    </Sheet>
  );
}

function AskEntry({ entry, onCite, onResend, onDelete }: { entry: Entry; onCite: (pos: Pos) => void; onResend: () => void; onDelete: () => void }) {
  const ask = useQuery(api.asks.get, entry.id ? { askId: entry.id } : "skip");
  const retry = useMutation(api.asks.retry);
  const remove = useMutation(api.asks.remove);
  const failed = entry.failed || ask?.status === "error";

  return (
    <section className="group space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground/90">{ask?.question ?? entry.question}</p>
        <button
          type="button"
          aria-label="Delete this answer"
          title="Delete"
          onClick={() => {
            if (entry.id) void remove({ askId: entry.id }).catch(() => {});
            onDelete();
          }}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-11 [&_svg]:size-3.5"
        >
          <Trash2 />
        </button>
      </div>
      {failed ? (
        <div className="space-y-2 text-sm">
          <p className="text-destructive">{ask?.error ?? "Couldn't send the question."}</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline [&_svg]:size-3.5"
            onClick={() => (entry.id ? void retry({ askId: entry.id }).catch(() => {}) : onResend())}
          >
            <RotateCcw /> Try again
          </button>
        </div>
      ) : ask?.status === "ready" && ask.answer ? (
        <Answer text={ask.answer} onCite={onCite} />
      ) : (
        <div className="space-y-2.5" aria-busy="true">
          <p className="font-serif text-sm text-muted-foreground italic">Thinking it over…</p>
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      )}
    </section>
  );
}
