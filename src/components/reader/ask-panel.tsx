"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Anchor, Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { Answer } from "./answer";
import { IconBtn, field } from "./kit";
import { keepKeys, type AskKind } from "./lens";
import { Failed, Loading, Quote, Sheet, SheetBody, SheetFooter } from "./sheet";

/** A stretch of the book being asked about. */
export type Passage = { anchor: Anchor; quote: string };

/** How each one-tap question reads (the backend stores the same wording). */
const QUESTION: Record<Exclude<AskKind, "ask">, string> = {
  explain: "What does this mean here?",
  define: "What does this word mean here?",
  simplify: "Can you say it more simply?",
};

const TITLE: Record<AskKind, string> = { explain: "Explain", define: "Define", simplify: "Simplify", ask: "Question" };

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
      <SheetBody className="space-y-6">
        <Quote text={thread.passage.quote} className="line-clamp-6" />
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
      </SheetBody>
      <SheetFooter>
        <form
          className="flex w-full items-center gap-2"
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
            placeholder="Ask a follow-up"
            aria-label="Follow-up question"
            className={cn(field, "h-9 min-w-0 flex-1 pointer-coarse:h-11")}
          />
          <IconBtn type="submit" tone="primary" label="Ask" disabled={!draft.trim()}>
            <ArrowUp />
          </IconBtn>
        </form>
      </SheetFooter>
    </Sheet>
  );
}

function AskEntry({ entry, onCite, onResend, onDelete }: { entry: Entry; onCite: (pos: Pos) => void; onResend: () => void; onDelete: () => void }) {
  const ask = useQuery(api.asks.get, entry.id ? { askId: entry.id } : "skip");
  const retry = useMutation(api.asks.retry);
  const remove = useMutation(api.asks.remove);
  const failed = entry.failed || ask?.status === "error";

  return (
    <section className="space-y-2 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 pt-1 text-base leading-6 font-medium pointer-coarse:pt-2.5">{ask?.question ?? entry.question}</p>
        <IconBtn
          size="sm"
          label="Delete answer"
          className="-mr-2"
          onClick={() => {
            if (entry.id) void remove({ askId: entry.id }).catch(() => {});
            onDelete();
          }}
        >
          <Trash2 />
        </IconBtn>
      </div>
      {failed ? (
        <Failed
          message={ask?.error ?? "Couldn't send the question."}
          onRetry={() => (entry.id ? void retry({ askId: entry.id }).catch(() => {}) : onResend())}
        />
      ) : ask?.status === "ready" && ask.answer ? (
        <Answer text={ask.answer} onCite={onCite} />
      ) : (
        <Loading label="Answering…" />
      )}
    </section>
  );
}
