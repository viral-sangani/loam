"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** The room's scene colour: the loader, the fade back from the reader and the browser bar use it. */
export const SCENE = "#070403";

/**
 * The lamp being lit while the room loads. The same picture is shown while the code downloads,
 * while sign-in is confirmed and while the scene is built, so the steps read as one. It fades out
 * over the first frame of the room rather than cutting to it. The words only appear on slow loads.
 */
export function RoomLoader({ visible = true }: { visible?: boolean }) {
  const [gone, setGone] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setGone(false);
  }
  if (gone) return null;
  return (
    <div
      role="status"
      aria-label="Loading the library"
      onTransitionEnd={(e) => e.target === e.currentTarget && !visible && setGone(true)}
      className={cn(
        "fixed inset-0 z-40 flex items-center justify-center transition-opacity duration-700 ease-out motion-reduce:duration-1",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ background: SCENE }}
    >
      <div className="flex flex-col items-center gap-5">
        <div aria-hidden className="loam-lamp size-2.5 rounded-full bg-[#ffc98a]" />
        <p className="loam-lamp-words text-sm tracking-[0.14em] text-[rgba(239,228,207,0.7)] [font-variant-caps:all-small-caps]">Lighting the lamp</p>
      </div>
    </div>
  );
}
