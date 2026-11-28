"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { RotateCw, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Pos } from "@/lib/anchors";
import { Answer } from "./answer";
import { Btn, IconBtn } from "./kit";
import { CompanionTabs, useJump } from "./panel-bits";
import { Failed, Loading, Sheet, SheetBody } from "./sheet";

/** The backend reuses a recap made within this many paragraphs (same section), so that's "the same spot". */
const SAME_SPOT_PARAS = 5;

const isAhead = (pos: Pos, of: Pos) => pos.section > of.section || (pos.section === of.section && pos.para - of.para > SAME_SPOT_PARAS);

/** Recap: the book so far, up to where you are. */
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
  /** Switch to Ask; without it, the tabs are hidden. */
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
    <Sheet title="Recap" heading={onSwitch && <CompanionTabs current="recap" onSwitch={onSwitch} />} variant="side" onClose={onClose}>
      <SheetBody>
        {error ? (
          <Failed message="Couldn't write the recap." onRetry={() => again(true)} />
        ) : recap?.status === "ready" && recap.text ? (
          <>
            <Answer text={recap.text} onCite={jump} />
            {position && isAhead(position, recap.upTo) && (
              <div className="mt-6 border-t border-border pt-4">
                <Btn size="sm" icon={<RotateCw />} onClick={() => again(true)}>
                  Update to this page
                </Btn>
              </div>
            )}
          </>
        ) : (
          <>
            <Loading label={position ? "Writing the recap…" : "Loading…"} />
            <p className="mt-6 text-xs leading-4 text-muted-foreground">The first recap of a book takes about a minute. Later ones are quicker.</p>
          </>
        )}
      </SheetBody>
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
        className="pointer-events-auto flex animate-in items-center gap-1 rounded-xl border border-border bg-popover p-1 text-sm shadow-md shadow-black/8 duration-200 fade-in"
      >
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onOpen();
          }}
          className="inline-flex h-9 cursor-pointer items-center rounded-lg px-3 font-medium transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:h-11"
        >
          Recap
        </button>
        <IconBtn label="Dismiss" onClick={() => setDismissed(true)}>
          <X />
        </IconBtn>
      </div>
    </div>
  );
}
