"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { keepKeys } from "./lens";
import { MARK_COLORS, SWATCH, markColor, type Mark, type MarkColor } from "./use-marks";
import { Sheet } from "./sheet";

/** A tapped highlight: its words, a note (saved when you leave the field), its colour, and a way to ask about it. */
export function MarkPanel({
  mark,
  onUpdate,
  onRemove,
  onExplain,
  onClose,
}: {
  mark: Mark;
  onUpdate: (markId: Id<"marks">, patch: { note?: string; color?: MarkColor }) => void;
  onRemove: (markId: Id<"marks">) => void;
  onExplain: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(mark.note ?? "");
  const color = markColor(mark.color);

  // Save on blur, and also when the panel closes while the note is still being typed.
  const latest = useRef({ note, saved: mark.note ?? "", save: (n: string) => onUpdate(mark._id, { note: n }) });
  useEffect(() => {
    latest.current.note = note;
  }, [note]);
  useEffect(() => {
    const l = latest.current;
    return () => {
      if (l.note.trim() !== l.saved.trim()) l.save(l.note);
    };
  }, []);
  const save = () => {
    const l = latest.current;
    if (note.trim() === l.saved.trim()) return;
    l.saved = note;
    l.save(note);
  };

  return (
    <Sheet title="Highlight" variant="popover" onClose={onClose}>
      <div className="space-y-4 px-5 pt-1 pb-6 sm:p-4">
        <blockquote className="line-clamp-6 font-serif text-[15px] leading-relaxed">
          <span className="box-decoration-clone px-0.5" style={{ background: `color-mix(in oklch, ${SWATCH[color]} 38%, transparent)` }}>
            {mark.quote}
          </span>
        </blockquote>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => keepKeys(e, () => (e.target as HTMLTextAreaElement).blur())}
          rows={3}
          maxLength={4000}
          placeholder="Add a note…"
          aria-label="Note"
          className="w-full resize-none rounded-xl bg-secondary/70 px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:text-base"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center" role="radiogroup" aria-label="Colour">
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                onClick={() => c !== color && onUpdate(mark._id, { color: c })}
                className="grid size-8 place-items-center rounded-xl transition-colors hover:bg-muted pointer-coarse:size-11"
              >
                <span
                  className={cn("size-4 rounded-full ring-1 ring-foreground/15", c === color && "ring-2 ring-foreground/60 ring-offset-2 ring-offset-card")}
                  style={{ background: SWATCH[c] }}
                />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete highlight"
            title="Delete"
            className="text-muted-foreground hover:text-destructive pointer-coarse:size-11"
            onClick={() => {
              latest.current.saved = note; // nothing left to save
              onRemove(mark._id);
              onClose();
            }}
          >
            <Trash2 />
          </Button>
        </div>
        <Button variant="secondary" className="w-full pointer-coarse:h-11" onClick={onExplain}>
          <Sparkles /> Explain this
        </Button>
      </div>
    </Sheet>
  );
}
