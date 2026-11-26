"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Btn, IconBtn, field } from "./kit";
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
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 pt-1 pb-6 sm:p-5 short:p-5">
        <blockquote className="line-clamp-6 font-book text-base leading-relaxed">
          <span className="box-decoration-clone px-0.5" style={{ background: `color-mix(in oklch, ${SWATCH[color]} 40%, transparent)` }}>
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
          placeholder="Add a note"
          aria-label="Note"
          className={cn(field, "block resize-none py-2 leading-5")}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="-ml-1.5 flex items-center gap-1 pointer-coarse:gap-2" role="radiogroup" aria-label="Colour">
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                title={c[0].toUpperCase() + c.slice(1)}
                onClick={() => c !== color && onUpdate(mark._id, { color: c })}
                className="grid size-9 cursor-pointer place-items-center rounded-lg transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:size-11"
              >
                <span
                  className={cn("size-5 rounded-full ring-1 ring-black/10", c === color && "ring-2 ring-foreground ring-offset-2 ring-offset-card")}
                  style={{ background: SWATCH[c] }}
                />
              </button>
            ))}
          </div>
          <IconBtn
            label="Delete highlight"
            className="-mr-1.5 hover:text-destructive"
            onClick={() => {
              latest.current.saved = note; // nothing left to save
              onRemove(mark._id);
              onClose();
            }}
          >
            <Trash2 />
          </IconBtn>
        </div>
        <Btn className="w-full" onClick={onExplain}>
          Explain this passage
        </Btn>
      </div>
    </Sheet>
  );
}
