"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, BookA, Feather, MessageCircleQuestionMark, PenLine, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { MARK_COLORS, SWATCH, type MarkColor } from "./use-marks";
import type { Picked } from "./use-selection";

export type AskKind = "explain" | "define" | "simplify" | "ask";

/** Selections up to this many words get "Define"; longer ones get "Simplify" in the same slot. */
const DEFINE_MAX_WORDS = 4;
const GAP = 10;
const EDGE = 8;

/**
 * Keys typed in a text field stay there: the reader's shortcuts listen on the window, so without
 * this, typing "n" would switch the theme. Escape is left to the field's own handler.
 */
export function keepKeys(e: KeyboardEvent, onEscape?: () => void) {
  e.stopPropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    onEscape?.();
  }
}

/**
 * The small toolbar over a selection: highlight in a colour, add a note, or ask about it.
 * Note and Ask turn it into a one-line input; `onFreeze` keeps the selection while typing.
 */
export function Lens({
  picked,
  onHighlight,
  onNote,
  onAsk,
  onFreeze,
  onClose,
}: {
  picked: Picked;
  onHighlight: (color: MarkColor) => void;
  onNote: (note: string) => void;
  onAsk: (kind: AskKind, question?: string) => void;
  onFreeze: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"actions" | "note" | "ask">("actions");
  const [text, setText] = useState("");

  // Place it centred over the selection, above it (below on touch screens, where the system's
  // own copy/look-up menu sits above), flipping when there's no room and staying on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { box } = picked;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = box.top - GAP - h;
    const below = box.bottom + GAP;
    const fitsAbove = above >= EDGE;
    const fitsBelow = below + h <= vh - EDGE;
    const preferBelow = window.matchMedia("(pointer: coarse)").matches;
    let top = preferBelow ? (fitsBelow ? below : fitsAbove ? above : below) : fitsAbove ? above : fitsBelow ? below : above;
    top = Math.min(Math.max(top, EDGE), vh - h - EDGE);
    const left = Math.min(Math.max((box.left + box.right) / 2 - w / 2, EDGE), vw - w - EDGE);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "visible";
  }, [picked, mode]);

  const typeInto = (m: "note" | "ask") => {
    onFreeze();
    setText("");
    setMode(m);
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (mode === "note") onNote(t);
    else onAsk("ask", t);
  };
  const short = picked.words <= DEFINE_MAX_WORDS;

  return (
    <div
      ref={ref}
      data-lens
      role="toolbar"
      aria-label="Selection"
      style={{ visibility: "hidden" }}
      className="fixed z-30 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-popover/95 p-1 text-popover-foreground shadow-lg shadow-foreground/10 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150"
    >
      {mode === "actions" ? (
        <div className="flex flex-wrap items-center justify-center gap-0.5">
          <div className="flex items-center" role="group" aria-label="Highlight">
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Highlight ${c}`}
                title={c === "yellow" ? "Highlight" : `Highlight ${c}`}
                onClick={() => onHighlight(c)}
                className="grid size-8 place-items-center rounded-xl transition-colors hover:bg-muted pointer-coarse:size-11"
              >
                <span className="size-3.5 rounded-full ring-1 ring-foreground/15" style={{ background: SWATCH[c] }} />
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <Action icon={<PenLine />} label="Note" onClick={() => typeInto("note")} />
            <Action icon={<Sparkles />} label="Explain" onClick={() => onAsk("explain")} />
            {short ? (
              <Action icon={<BookA />} label="Define" onClick={() => onAsk("define")} />
            ) : (
              <Action icon={<Feather />} label="Simplify" onClick={() => onAsk("simplify")} />
            )}
            <Action icon={<MessageCircleQuestionMark />} label="Ask" onClick={() => typeInto("ask")} />
          </div>
        </div>
      ) : (
        <form
          className="flex w-[min(24rem,calc(100vw-2rem))] items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => keepKeys(e, onClose)}
            maxLength={mode === "ask" ? 1000 : 4000}
            placeholder={mode === "note" ? "Add a note…" : "Ask about this passage…"}
            aria-label={mode === "note" ? "Note" : "Question"}
            className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-[14px] outline-none placeholder:text-muted-foreground pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <button
            type="submit"
            aria-label={mode === "note" ? "Save note" : "Ask"}
            disabled={!text.trim()}
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-4"
          >
            {mode === "note" ? <PenLine /> : <ArrowUp />}
          </button>
        </form>
      )}
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[13px] text-foreground/85 transition-colors hover:bg-muted hover:text-foreground",
        "pointer-coarse:h-11 pointer-coarse:px-3 [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
