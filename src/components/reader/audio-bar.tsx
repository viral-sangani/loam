"use client";

import { LocateFixed, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const note = !audio.available
    ? "No audiobook yet. Add one from the shelf with the headphones button."
    : audio.status === "error"
      ? "Couldn't sync this audiobook. You can still listen."
      : !audio.synced
        ? audio.status === "aligning"
          ? `Matching the audio to the text… ${Math.round(audio.progress * 100)}%. You can listen meanwhile.`
          : "Waiting for the aligner to match the audio to the text. You can listen meanwhile."
        : null;
  const nextRate = SPEEDS[(SPEEDS.indexOf(audio.rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
  const icon = "text-muted-foreground pointer-coarse:size-11";

  return (
    <footer
      aria-label="Audiobook"
      className="absolute inset-x-0 bottom-0 z-20 px-[max(1rem,4vw)] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {note && <p className="mb-1.5 truncate text-center text-[11px] text-muted-foreground">{note}</p>}
      <div className="mx-auto flex max-w-xl items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
        <Button
          size="icon"
          aria-label={audio.playing ? "Pause" : "Play"}
          disabled={!audio.available}
          onClick={audio.toggle}
          className="size-9 rounded-full pointer-coarse:size-11"
        >
          {audio.playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Back 15 seconds" className={icon} disabled={!audio.available} onClick={() => audio.skip(-15_000)}>
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 30 seconds" className={icon} disabled={!audio.available} onClick={() => audio.skip(30_000)}>
          <RotateCw />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {clock(audio.position)}
          {audio.total > 0 && <span className="opacity-60"> / {clock(audio.total)}</span>}
        </span>
        {audio.synced && !audio.follow && (
          <Button variant="ghost" size="sm" className="text-primary pointer-coarse:h-11" onClick={audio.resync} title="Go back to the narration">
            <LocateFixed /> <span className="hidden sm:inline">Follow</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Playback speed ${audio.rate}×`}
          className={cn("w-12 font-mono text-xs tabular-nums text-muted-foreground pointer-coarse:h-11")}
          onClick={() => audio.setRate(nextRate)}
        >
          {audio.rate}×
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close player" className={icon} onClick={onClose}>
          <X />
        </Button>
      </div>
    </footer>
  );
}
