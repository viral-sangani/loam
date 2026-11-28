"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { ReaderTerm } from "./use-terms";
import { Failed, Loading, SectionLabel, Sheet, SheetBody } from "./sheet";

const link =
  "flex w-fit min-h-9 cursor-pointer items-center gap-2 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 [&_svg]:size-4 [&_svg]:shrink-0";

/** The right-hand panel for a tapped term: a short briefing, then what it means in this passage. */
export function BriefPanel({ term, onClose }: { term: ReaderTerm; onClose: () => void }) {
  const termId = term._id;
  const request = useMutation(api.briefs.request);
  const brief = useQuery(api.briefs.get, { termId });

  const [requestFailed, setRequestFailed] = useState(false);
  const load = useCallback(() => {
    void request({ termId }).catch(() => setRequestFailed(true));
  }, [request, termId]);
  useEffect(load, [load]);

  const d = brief?.data;
  const text = d ?? term.explanation;
  const failed = requestFailed || brief?.status === "error" || brief === null;
  return (
    <Sheet title={text?.title ?? term.term} variant="side" onClose={onClose}>
      <SheetBody className="space-y-6">
        {!text && (failed ? (
          <Failed message="Couldn't load the explanation." onRetry={() => { setRequestFailed(false); load(); }} />
        ) : <Loading label="Writing an explanation…" />)}
        {text && (
          <>
            <p className="text-base leading-relaxed">{text.summary}</p>
            {text.context && (
              <section className="space-y-2 border-t border-border pt-5">
                <SectionLabel>In this passage</SectionLabel>
                <p className="text-base leading-relaxed">{text.context}</p>
              </section>
            )}
          </>
        )}
        {d && (
          <>
            {(d.image || d.description) && (
              <figure className="space-y-2">
                {d.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.image} alt={d.title} loading="lazy" className="max-h-56 w-full rounded-lg border border-border object-cover" />
                )}
                {d.description && <figcaption><SectionLabel>{d.description}</SectionLabel></figcaption>}
              </figure>
            )}
            {(d.video || d.wikiUrl) && (
              <section className="space-y-1 border-t border-border pt-5">
                {d.video && (
                  <div className="mb-3 overflow-hidden rounded-lg border border-border">
                    <iframe
                      className="aspect-video w-full"
                      src={`https://www.youtube-nocookie.com/embed/${d.video.id}`}
                      title={d.video.title}
                      loading="lazy"
                      allow="encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
                {d.wikiUrl && (
                  <a href={d.wikiUrl} target="_blank" rel="noreferrer" className={link}>
                    <ExternalLink /> Read on Wikipedia
                  </a>
                )}
              </section>
            )}
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}
