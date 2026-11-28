"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { Segmented } from "./kit";

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
        "inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm transition-colors duration-150 pointer-coarse:h-11 pointer-coarse:min-w-11",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4",
        armed ? "bg-destructive/10 px-2.5 font-medium text-destructive" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Trash2 />
      {armed && "Delete"}
    </button>
  );
}

/** Ask and Recap, two views of the same companion, as tabs in the panel's header. */
export function CompanionTabs({ current, onSwitch }: { current: "ask" | "recap"; onSwitch: (p: "ask" | "recap") => void }) {
  return (
    <Segmented
      tabs
      label="Companion"
      className="max-w-64 min-w-0 flex-1"
      options={[
        ["ask", "Ask"],
        ["recap", "Recap"],
      ]}
      value={current}
      onChange={onSwitch}
    />
  );
}
