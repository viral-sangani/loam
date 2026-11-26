"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BookOpen, Check } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";

type Item = FunctionReturnType<typeof api.review.today>["items"][number];

/** How long "That's today's review" stays before the desk folds away. */
const END_MS = 4000;

/**
 * The daily review on the shelf: one highlight or looked-up term at a time, spaced out like
 * flashcards. Keep brings it back later, Done retires it. Nothing at all when nothing is due.
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
    <section aria-label="Daily review" className="mb-8 rounded-2xl border border-border/70 bg-card/70 px-5 py-4 sm:mb-10 sm:px-6 sm:py-5">
      <header className="mb-3 flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
        <span className="tracking-wide uppercase">Today&apos;s review</span>
        {remaining > 1 && <span className="tabular-nums">{remaining - 1} more today</span>}
      </header>

      {finished ? (
        <p className="flex items-center gap-2 py-1 font-serif text-muted-foreground italic motion-safe:animate-in motion-safe:fade-in">
          <Check className="size-4 text-primary" /> That&apos;s today&apos;s review.
        </p>
      ) : item ? (
        <div key={item.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
          <Card item={item} />
          <div className="mt-4 flex items-center justify-between gap-2">
            <Link
              href={`/read/${item.bookId}?s=${item.section}&p=${item.para}`}
              className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-3" })}
            >
              <BookOpen /> Open in book
            </Link>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                title="Retire it from the review"
                className="text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-3"
                onClick={() => act("done", item)}
              >
                Done
              </Button>
              <Button variant="secondary" size="sm" title="Show it again later" className="pointer-coarse:h-11 pointer-coarse:px-4" onClick={() => act("keep", item)}>
                Keep
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // Everything on hand was answered; the next few are on their way from the server.
        <p className="py-1 font-serif text-muted-foreground italic">One moment…</p>
      )}
    </section>
  );
}

function Card({ item }: { item: Item }) {
  return (
    <article>
      {item.kind === "mark" ? (
        <>
          <blockquote className="line-clamp-[8] border-l-2 border-clay/60 pl-4 font-serif text-lg leading-relaxed">{item.quote}</blockquote>
          {item.note && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">{item.note}</p>}
        </>
      ) : (
        <>
          <p className="font-serif text-lg leading-snug">{item.title}</p>
          <p className="mt-1.5 line-clamp-5 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
        </>
      )}
      <p className="mt-3 truncate text-[11px] text-muted-foreground">
        <span className="tracking-wide uppercase">{item.kind === "mark" ? "Highlight" : "Looked up"}</span>
        {item.bookTitle && (
          <>
            <span className="mx-1.5 opacity-50">·</span>
            <span className="font-serif text-xs italic">{item.bookTitle}</span>
          </>
        )}
      </p>
    </article>
  );
}
