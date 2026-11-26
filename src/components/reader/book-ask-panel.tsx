"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUp } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { Pos } from "@/lib/anchors";
import { Answer } from "./answer";
import { CompanionTabs, DeleteButton, Pending, useJump } from "./panel-bits";
import { Sheet } from "./sheet";

/** Starters that can only be answered from what's been read, so none of them invites a spoiler. */
const STARTERS = [
  "What has happened so far?",
  "Who are the main people so far, and how are they connected?",
  "What should I keep in mind going into the next chapter?",
];

/** "Ask about the book so far": questions answered only from the text up to where you are. */
export function BookAskPanel({
  bookId,
  position,
  onJump,
  onClose,
  onSwitch,
}: {
  bookId: Id<"books">;
  /** The first paragraph on screen; null until the reader knows it. */
  position: Pos | null;
  onJump: (pos: Pos) => void;
  onClose: () => void;
  /** Switch to the story so far; without it, the tabs are hidden. */
  onSwitch?: (p: "ask" | "recap") => void;
}) {
  const asks = useQuery(api.asks.list, { bookId });
  const create = useMutation(api.asks.create);
  const jump = useJump(onJump, onClose);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || !position || sending) return;
    setSending(true);
    try {
      await create({ bookId, kind: "book", question: q, position });
      setDraft("");
    } catch {
      // The draft stays, so nothing typed is lost; the button can be pressed again.
    } finally {
      setSending(false);
    }
  };

  const mine = (asks ?? []).filter((a) => a.kind === "book").sort((a, b) => b.createdAt - a.createdAt);
  const ready = position !== null;

  return (
    <Sheet title="Ask the book" variant="side" onClose={onClose}>
      {onSwitch && <CompanionTabs current="ask" onSwitch={onSwitch} />}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
          className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:border-ring/60"
        >
          <textarea
            value={draft}
            rows={1}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            placeholder={ready ? "Ask about the book so far…" : "Finding your place…"}
            aria-label="Your question"
            maxLength={1000}
            className="field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-[15px] leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
          />
          <Button type="submit" size="icon-sm" aria-label="Ask" disabled={!ready || sending || !draft.trim()} className="rounded-full pointer-coarse:size-11">
            <ArrowUp />
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Answers only use the text up to where you are, so nothing ahead is spoiled.</p>

        {!draft && (
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!ready || sending}
                onClick={() => void ask(s)}
                className="rounded-full border border-border px-3 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50 pointer-coarse:py-2.5"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-6">
          {mine.map((a) => (
            <BookQuestion key={a._id} ask={a} onJump={jump} />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

type BookAsk = FunctionReturnType<typeof api.asks.list>[number];

function BookQuestion({ ask, onJump }: { ask: BookAsk; onJump: (pos: Pos) => void }) {
  const retry = useMutation(api.asks.retry);
  const remove = useMutation(api.asks.remove);
  return (
    <article className="border-t border-border/60 pt-4 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-2">
        <h3 className="pt-0.5 text-[15px] leading-snug font-medium">{ask.question}</h3>
        <DeleteButton label="Delete question" onDelete={() => void remove({ askId: ask._id })} />
      </div>
      <div className="mt-2">
        {ask.status === "pending" && <Pending note="Reading back through what you've read…" />}
        {ask.status === "error" && (
          <p className="text-sm text-destructive">
            Couldn&apos;t get an answer.{" "}
            <button type="button" className="text-primary underline underline-offset-4" onClick={() => void retry({ askId: ask._id })}>
              Retry
            </button>
          </p>
        )}
        {ask.status === "ready" && ask.answer && <Answer text={ask.answer} onCite={onJump} />}
      </div>
    </article>
  );
}
