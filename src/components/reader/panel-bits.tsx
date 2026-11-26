"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";

/**
 * Jumping to a passage from a panel. On phones the panel is a bottom sheet over the text,
 * so it closes to show the passage; on larger screens it's a side panel and stays open.
 */
export function useJump(onJump: (pos: Pos) => void, onClose: () => void) {
  return useCallback(
    (pos: Pos) => {
      onJump(pos);
      if (!window.matchMedia("(min-width: 40rem)").matches) onClose();
    },
    [onJump, onClose],
  );
}

/** A delete button that asks once: the first press arms it, a second within a few seconds deletes. */
export function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      aria-label={armed ? `Confirm: ${label}` : label}
      title={label}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors pointer-coarse:h-11 pointer-coarse:px-3",
        armed ? "bg-destructive/10 text-destructive" : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
      )}
    >
      <Trash2 className="size-3.5" />
      {armed && "Delete"}
    </button>
  );
}

/** Small uppercase label, used for kinds of entries and chapter groups. */
export function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-[11px] font-medium tracking-wide text-muted-foreground uppercase", className)}>{children}</p>;
}

/** Placeholder lines while the AI writes. */
export function Pending({ note, lines = 3 }: { note: string; lines?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true">
      <p className="font-serif text-sm text-muted-foreground italic">{note}</p>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${[92, 78, 60, 85][i % 4]}%` }} />
      ))}
    </div>
  );
}

/** Switch between asking the book and the story so far: two views of the same companion. */
export function CompanionTabs({ current, onSwitch }: { current: "ask" | "recap"; onSwitch: (p: "ask" | "recap") => void }) {
  const tab = (p: "ask" | "recap", text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={current === p}
      onClick={() => current !== p && onSwitch(p)}
      className={cn(
        "flex-1 rounded-full px-3 py-1.5 text-sm transition-colors pointer-coarse:py-2.5",
        current === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {text}
    </button>
  );
  return (
    <div role="tablist" className="mx-5 mb-3 flex gap-1 rounded-full bg-secondary p-1">
      {tab("ask", "Ask")}
      {tab("recap", "Story so far")}
    </div>
  );
}
