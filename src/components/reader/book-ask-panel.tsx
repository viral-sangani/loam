"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUp } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Pos } from "@/lib/anchors";
import { Answer } from "./answer";
import { IconBtn } from "./kit";
import { CompanionTabs, DeleteButton, useJump } from "./panel-bits";
import { Failed, Loading, SectionLabel, Sheet, SheetBody } from "./sheet";

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
      <SheetBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
          className="flex items-end gap-2 rounded-lg border border-input bg-background py-1 pr-1 pl-3 transition-colors duration-150 focus-within:border-ring/50"
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
            placeholder={ready ? "Ask about the book so far" : "Loading…"}
            aria-label="Your question"
            maxLength={1000}
            className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 placeholder:text-muted-foreground focus:outline-none disabled:opacity-60 pointer-coarse:min-h-11 pointer-coarse:py-3 pointer-coarse:text-base"
          />
          <IconBtn type="submit" tone="primary" size="sm" label="Ask" disabled={!ready || sending || !draft.trim()}>
            <ArrowUp />
          </IconBtn>
        </form>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">Answers use only the pages you&apos;ve read.</p>

        {!draft && (
          <section className="mt-6 space-y-2">
            <SectionLabel>Try asking</SectionLabel>
            <div className="space-y-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!ready || sending}
                  onClick={() => void ask(s)}
                  className="flex min-h-9 w-full cursor-pointer items-center rounded-lg border border-border px-3 py-2 text-left text-sm leading-5 transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-45 pointer-coarse:min-h-11"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6">
          {mine.map((a) => (
            <BookQuestion key={a._id} ask={a} onJump={jump} />
          ))}
        </div>
      </SheetBody>
    </Sheet>
  );
}

type BookAsk = FunctionReturnType<typeof api.asks.list>[number];

function BookQuestion({ ask, onJump }: { ask: BookAsk; onJump: (pos: Pos) => void }) {
  const retry = useMutation(api.asks.retry);
  const remove = useMutation(api.asks.remove);
  return (
    <article className="border-t border-border py-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 pt-1 text-base leading-6 font-medium pointer-coarse:pt-2.5">{ask.question}</h3>
        <div className="-mr-2">
          <DeleteButton label="Delete question" onDelete={() => void remove({ askId: ask._id })} />
        </div>
      </div>
      <div className="mt-2">
        {ask.status === "pending" && <Loading label="Answering…" />}
        {ask.status === "error" && <Failed message="Couldn't get an answer." onRetry={() => void retry({ askId: ask._id })} />}
        {ask.status === "ready" && ask.answer && <Answer text={ask.answer} onCite={onJump} />}
      </div>
    </article>
  );
}
