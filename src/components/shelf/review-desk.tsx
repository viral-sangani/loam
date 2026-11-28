"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Btn, btnClass } from "@/components/reader/kit";
import { Quote } from "@/components/reader/sheet";

type Item = FunctionReturnType<typeof api.review.today>["items"][number];

/** How long "Done for today." stays before the desk folds away. */
const END_MS = 4000;

/**
 * The daily review in the library: one highlight or term at a time, spaced out like flashcards.
 * "Show again later" brings it back later, "Done" retires it. Nothing at all when nothing is due.
 */
export function ReviewDesk() {
  const review = useQuery(api.review.today, {});
  const keep = useMutation(api.review.keep);
  const done = useMutation(api.review.done);
  // Items acted on but not yet gone from the query: hidden right away so a card can't be answered twice.
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [acted, setActed] = useState(false);
  const [gone, setGone] = useState(false);

  const items = review?.items ?? [];
  const pending = items.filter((i) => handled.has(i.id)).length;
  const remaining = Math.max(0, (review?.due ?? 0) - pending);
  const item = items.find((i) => !handled.has(i.id));
  const finished = acted && remaining === 0;

  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => setGone(true), END_MS);
    return () => clearTimeout(t);
  }, [finished]);

  if (!review || gone || (!remaining && !acted)) return null;

  const act = (kind: "keep" | "done", it: Item) => {
    setActed(true);
    setHandled((h) => new Set(h).add(it.id));
    void (kind === "keep" ? keep : done)({ kind: it.kind, id: it.id }).catch((e) => {
      console.error(e);
      // Put it back so it isn't silently lost.
      setHandled((h) => {
        const rest = new Set(h);
        rest.delete(it.id);
        return rest;
      });
    });
  };

  return (
    <section aria-label="Daily review" className="mb-8 rounded-lg border border-border bg-card px-5 py-4 sm:mb-10 sm:px-6 sm:py-5">
      <header className="mb-3 flex items-baseline justify-between gap-4 text-xs font-medium text-muted-foreground">
        <span>Today&apos;s review</span>
        {remaining > 1 && <span className="tabular-nums">{remaining - 1} more today</span>}
      </header>

      {finished ? (
        <p className="py-1 text-sm text-muted-foreground">Done for today.</p>
      ) : item ? (
        <div key={item.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          <Card item={item} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Link href={`/read/${item.bookId}?s=${item.section}&p=${item.para}`} className={btnClass({ tone: "ghost", size: "sm", className: "-ml-3" })}>
              Open in book
            </Link>
            <div className="flex items-center gap-1 pointer-coarse:gap-2">
              <Btn tone="ghost" size="sm" onClick={() => act("done", item)}>
                Done
              </Btn>
              <Btn size="sm" onClick={() => act("keep", item)}>
                Show again later
              </Btn>
            </div>
          </div>
        </div>
      ) : (
        // Everything on hand was answered; the next few are on their way from the server.
        <p role="status" className="py-1 text-sm text-muted-foreground">
          Loading…
        </p>
      )}
    </section>
  );
}

function Card({ item }: { item: Item }) {
  return (
    <article>
      {item.kind === "mark" ? (
        <>
          <Quote text={item.quote} className="line-clamp-8" />
          {item.note && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">{item.note}</p>}
        </>
      ) : (
        <>
          <p className="text-base leading-snug font-medium">{item.title}</p>
          <p className="mt-1.5 line-clamp-5 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
        </>
      )}
      <p className="mt-3 truncate text-xs font-medium text-muted-foreground">
        {item.kind === "mark" ? "Highlight" : "Term"}
        {item.bookTitle && ` · ${item.bookTitle}`}
      </p>
    </article>
  );
}
