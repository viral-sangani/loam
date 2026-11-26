"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { History, RotateCw, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { Pos } from "@/lib/anchors";
import { Answer } from "./answer";
import { CompanionTabs, Pending, useJump } from "./panel-bits";
import { Sheet } from "./sheet";

/** The backend reuses a recap made within this many paragraphs (same section), so that's "the same spot". */
const SAME_SPOT_PARAS = 5;

const isAhead = (pos: Pos, of: Pos) => pos.section > of.section || (pos.section === of.section && pos.para - of.para > SAME_SPOT_PARAS);

/** "The story so far", up to where you are. */
export function RecapPanel({
  bookId,
  position,
  onJump,
  onClose,
  onSwitch,
}: {
  bookId: Id<"books">;
  /** The first paragraph on screen; the recap waits for it. */
  position: Pos | null;
  onJump: (pos: Pos) => void;
  onClose: () => void;
  /** Switch to asking the book; without it, the tabs are hidden. */
  onSwitch?: (p: "ask" | "recap") => void;
}) {
  const request = useMutation(api.recaps.request);
  const latest = useQuery(api.recaps.get, { bookId });
  const jump = useJump(onJump, onClose);
  const [recapId, setRecapId] = useState<Id<"recaps"> | null>(null);
  const [failed, setFailed] = useState(false);

  // Ask once per opening, as soon as the reader knows where you are.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current || !position) return;
    requested.current = true;
    void request({ bookId, upTo: position }).then(setRecapId, () => setFailed(true));
  }, [position, request, bookId]);

  const again = (fresh: boolean) => {
    const upTo = position ?? latest?.upTo;
    if (!upTo) return;
    setFailed(false);
    setRecapId(null);
    void request({ bookId, upTo, fresh }).then(setRecapId, () => setFailed(true));
  };

  // Only the recap asked for here; an older one from elsewhere in the book would mislead.
  const recap = recapId && latest?._id === recapId ? latest : null;
  const error = failed || recap?.status === "error";

  return (
    <Sheet title="The story so far" variant="side" onClose={onClose}>
      {onSwitch && <CompanionTabs current="recap" onSwitch={onSwitch} />}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
        {error ? (
          <div className="space-y-3 pt-1 text-sm">
            <p className="text-destructive">Couldn&apos;t write a recap.</p>
            <button type="button" className="text-primary underline underline-offset-4" onClick={() => again(true)}>
              Retry
            </button>
          </div>
        ) : recap?.status === "ready" && recap.text ? (
          <>
            <Answer text={recap.text} onCite={jump} className="font-serif" />
            {position && isAhead(position, recap.upTo) && (
              <Button variant="secondary" size="sm" className="mt-5 pointer-coarse:h-11 pointer-coarse:px-4" onClick={() => again(true)}>
                <RotateCw /> Recap from here
              </Button>
            )}
            <p className="mt-6 text-xs text-muted-foreground">Written only from what you&apos;ve read, so nothing ahead is spoiled.</p>
          </>
        ) : (
          <div className="pt-1">
            <Pending note={position ? "Gathering the story so far…" : "Finding your place…"} lines={4} />
            <p className="mt-5 text-xs text-muted-foreground">
              The first recap of a book takes a minute while each finished chapter is summarized. After that it&apos;s quick.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** How long away before offering a recap. */
const A_WHILE = 3 * 24 * 60 * 60 * 1000;
const SHOW_MS = 12_000;

/**
 * A quiet offer to recap, when the book was last opened a while ago. Reading saves progress,
 * which moves `openedAt` to now, so the first value seen decides (undefined = still loading).
 */
export function RecapNudge({ openedAt, onOpen }: { openedAt: number | null | undefined; onOpen: () => void }) {
  const [now] = useState(() => Date.now());
  const [first, setFirst] = useState(openedAt);
  if (first === undefined && openedAt !== undefined) setFirst(openedAt);
  const [dismissed, setDismissed] = useState(false);
  const due = first != null && now - first > A_WHILE && !dismissed;

  useEffect(() => {
    if (!due) return;
    const t = setTimeout(() => setDismissed(true), SHOW_MS);
    return () => clearTimeout(t);
  }, [due]);

  if (!due) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex animate-in items-center gap-1 rounded-full border border-border bg-card/95 py-1 pr-1 pl-3 text-sm shadow-md backdrop-blur-sm duration-500 fade-in slide-in-from-bottom-2"
      >
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onOpen();
          }}
          className="flex items-center gap-2 py-1 text-left pointer-coarse:py-2.5"
        >
          <History className="size-4 shrink-0 text-primary" />
          <span>
            <span className="text-muted-foreground">It&apos;s been a while.</span> Recap the story so far?
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" className="rounded-full text-muted-foreground pointer-coarse:size-11" onClick={() => setDismissed(true)}>
          <X />
        </Button>
      </div>
    </div>
  );
}
