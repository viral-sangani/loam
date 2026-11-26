"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Play } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Bullet, Failed, Loading, SectionLabel, Sheet, SheetBody } from "./sheet";

const link =
  "flex w-fit min-h-9 cursor-pointer items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 [&_svg]:size-4 [&_svg]:shrink-0";

/** The right-hand panel for a tapped term: a short briefing, then what it means in this passage. */
export function BriefPanel({ termId, onClose }: { termId: Id<"terms">; onClose: () => void }) {
  const request = useMutation(api.briefs.request);
  const brief = useQuery(api.briefs.get, { termId });

  useEffect(() => {
    void request({ termId }).catch(() => {});
  }, [request, termId]);

  const d = brief?.data;
  return (
    <Sheet title={d?.title ?? brief?.term ?? "Term"} variant="side" onClose={onClose}>
      <SheetBody className="space-y-6">
        {!d && brief?.status !== "error" && (
          <div className="space-y-4">
            <div className="h-40 rounded-lg bg-muted motion-safe:animate-pulse" />
            <Loading />
          </div>
        )}
        {brief?.status === "error" && <Failed message="Couldn't load this term." onRetry={() => void request({ termId })} />}
        {d && (
          <>
            {d.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.image} alt={d.title} className="max-h-56 w-full rounded-lg border border-border object-cover" />
            )}
            <section className="space-y-2">
              {d.description && <SectionLabel>{d.description}</SectionLabel>}
              <p className="text-base leading-relaxed">{d.summary}</p>
            </section>
            {d.points.length > 0 && (
              <ul className="space-y-2 text-sm leading-relaxed">
                {d.points.map((p) => (
                  <Bullet key={p}>{p}</Bullet>
                ))}
              </ul>
            )}
            {d.context && (
              <section className="space-y-2 border-t border-border pt-5">
                <SectionLabel>In this passage</SectionLabel>
                <p className="text-base leading-relaxed">{d.context}</p>
              </section>
            )}
            <section className="space-y-1 border-t border-border pt-4">
              {d.video ? (
                <div className="mb-3 overflow-hidden rounded-lg border border-border">
                  <iframe
                    className="aspect-video w-full"
                    src={`https://www.youtube-nocookie.com/embed/${d.video.id}`}
                    title={d.video.title}
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(d.videoSearch)}`} target="_blank" rel="noreferrer" className={link}>
                  <Play /> Find a video on YouTube
                </a>
              )}
              {d.wikiUrl && (
                <a href={d.wikiUrl} target="_blank" rel="noreferrer" className={link}>
                  <ExternalLink /> Read on Wikipedia
                </a>
              )}
            </section>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}
