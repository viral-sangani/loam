"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { libraryPath, type PublicDetails } from "@/lib/public-library";
import { IconBtn } from "./kit";

export function GuestAudio({ bookId, files, onClose }: {
  bookId: string;
  files: PublicDetails["audio"];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [error, setError] = useState(false);
  return (
    <footer aria-label="Audiobook" className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-xl border border-border bg-popover p-2">
        {files.length > 1 && (
          <select aria-label="Audiobook track" value={index} onChange={(event) => { setIndex(Number(event.target.value)); setError(false); }} className="max-w-[14ch] truncate rounded bg-muted px-2 py-1 text-sm">
            {files.map((file, i) => <option key={i} value={i}>{file.name || `Track ${i + 1}`}</option>)}
          </select>
        )}
        <audio key={index} controls preload="none" src={libraryPath(bookId, `audio-${index}`)} className="min-w-40 flex-1" aria-label="Audiobook player" onError={() => setError(true)} />
        <IconBtn label="Close player" onClick={onClose}><X /></IconBtn>
        {error && <p role="alert" className="basis-full px-2 text-sm text-muted-foreground">Audio is unavailable right now. Try again later.</p>}
      </div>
    </footer>
  );
}
