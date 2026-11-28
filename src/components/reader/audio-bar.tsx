"use client";

import { LocateFixed, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { Btn, IconBtn } from "./kit";
import { SPEEDS, type Audiobook } from "./use-audiobook";

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A slim listening bar along the bottom of the page. */
export function AudioBar({ audio, onClose }: { audio: Audiobook; onClose: () => void }) {
  const note =
    audio.status === "error"
      ? "Couldn't sync the audio to the text. Playback still works."
      : !audio.synced
        ? audio.status === "aligning"
          ? `Syncing audio to text (${Math.round(audio.progress * 100)}%)`
          : "Waiting to sync audio to text"
        : null;
  const nextRate = SPEEDS[(SPEEDS.indexOf(audio.rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
  const surface = "mx-auto max-w-xl rounded-xl border border-border bg-popover shadow-md shadow-black/8";

  return (
    <footer aria-label="Audiobook" className="absolute inset-x-0 bottom-0 z-20 pr-[max(1rem,4vw,calc(env(safe-area-inset-right)+0.5rem))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,4vw,calc(env(safe-area-inset-left)+0.5rem))] short:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {!audio.available ? (
        <div className={`${surface} flex items-center gap-2 p-1 pl-4`}>
          <p className="min-w-0 flex-1 py-1 text-sm leading-5 text-muted-foreground">No audiobook for this book. Add one from the library.</p>
          <IconBtn label="Close player" onClick={onClose}>
            <X />
          </IconBtn>
        </div>
      ) : (
        // The status sits inside the player's own surface, so it never lands on the book's last line as bare text.
        <div className={surface}>
          {note && <p className="truncate border-b border-border px-3 py-1.5 text-center text-xs leading-4 text-muted-foreground">{note}</p>}
          <div className="flex items-center gap-1 p-1 pointer-coarse:gap-1.5">
            <IconBtn tone="primary" label={audio.playing ? "Pause" : "Play"} onClick={audio.toggle} className="[&_svg]:fill-current">
              {audio.playing ? <Pause /> : <Play className="translate-x-px" />}
            </IconBtn>
            <IconBtn label="Back 15 seconds" onClick={() => audio.skip(-15_000)}>
              <RotateCcw />
            </IconBtn>
            <IconBtn label="Forward 30 seconds" onClick={() => audio.skip(30_000)}>
              <RotateCw />
            </IconBtn>
            <span className="min-w-0 flex-1 truncate px-1 text-center text-xs tabular-nums text-muted-foreground">
              {clock(audio.position)}
              {audio.total > 0 && <span> / {clock(audio.total)}</span>}
            </span>
            {audio.synced && !audio.follow && (
              <Btn
                tone="ghost"
                size="md"
                icon={<LocateFixed />}
                onClick={audio.resync}
                title="Go back to the narration"
                className="px-2 sm:pr-3"
              >
                <span className="hidden sm:inline">Follow</span>
              </Btn>
            )}
            <Btn
              tone="ghost"
              aria-label={`Playback speed ${audio.rate}×`}
              className="w-14 px-0 tabular-nums pointer-coarse:w-14 pointer-coarse:px-0"
              onClick={() => audio.setRate(nextRate)}
            >
              {audio.rate}×
            </Btn>
            <IconBtn label="Close player" onClick={onClose}>
              <X />
            </IconBtn>
          </div>
        </div>
      )}
    </footer>
  );
}
