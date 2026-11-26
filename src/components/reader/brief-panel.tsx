"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Play } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Sheet } from "./sheet";

/** The right-hand panel for a tapped term: a quick briefing, then what it means in this passage. */
export function BriefPanel({ termId, onClose }: { termId: Id<"terms">; onClose: () => void }) {
  const request = useMutation(api.briefs.request);
  const brief = useQuery(api.briefs.get, { termId });

  useEffect(() => {
    void request({ termId }).catch(() => {});
  }, [request, termId]);

  const d = brief?.data;
  return (
    <Sheet title={d?.title ?? brief?.term ?? "Learn more"} variant="side" onClose={onClose}>
      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-8">
        {!d && brief?.status !== "error" && (
          <div className="space-y-3 pt-1" aria-busy="true">
            <p className="font-serif text-sm text-muted-foreground italic">Gathering a quick briefing…</p>
            <div className="h-36 animate-pulse rounded-xl bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          </div>
        )}
        {brief?.status === "error" && (
          <div className="space-y-3 pt-1 text-sm">
            <p className="text-destructive">Couldn&apos;t put a briefing together.</p>
            <button type="button" className="text-primary underline underline-offset-4" onClick={() => void request({ termId })}>
              Try again
            </button>
          </div>
        )}
        {d && (
          <>
            {d.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.image} alt="" className="max-h-56 w-full rounded-xl bg-muted object-cover" />
            )}
            <div>
              {d.description && <p className="text-xs tracking-wide text-clay uppercase">{d.description}</p>}
              <p className="mt-1.5 text-[15px] leading-relaxed">{d.summary}</p>
            </div>
            {d.points.length > 0 && (
              <ul className="space-y-1.5 text-sm text-foreground/85">
                {d.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-primary/70" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.context && (
              <div className="rounded-xl bg-secondary/70 px-4 py-3">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">In this passage</p>
                <p className="mt-1 font-serif text-[15px] leading-relaxed">{d.context}</p>
              </div>
            )}
            {d.video ? (
              <div className="overflow-hidden rounded-xl bg-muted">
                <iframe
                  className="aspect-video w-full"
                  src={`https://www.youtube-nocookie.com/embed/${d.video.id}`}
                  title={d.video.title}
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(d.videoSearch)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
              >
                <Play className="size-4" /> Watch a short explainer
              </a>
            )}
            {d.wikiUrl && (
              <a
                href={d.wikiUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-4" /> Read more on Wikipedia
              </a>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
