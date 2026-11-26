"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconBtn } from "./kit";
import { MARK_COLORS, SWATCH, type MarkColor } from "./use-marks";
import type { Picked } from "./use-selection";

export type AskKind = "explain" | "define" | "simplify" | "ask";

/** Selections up to this many words get "Define"; longer ones get "Simplify" in the same slot. */
const DEFINE_MAX_WORDS = 4;
const GAP = 10;
const EDGE = 8;

/** The screen's safe-area insets (the notch, which sits at the side on a sideways phone), in px. */
function safeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return out;
}

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
  // Bumped when the visible area changes (an on-screen keyboard opening), so the toolbar is placed again.
  const [viewTick, setViewTick] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const bump = () => setViewTick((t) => t + 1);
    vv.addEventListener("resize", bump);
    vv.addEventListener("scroll", bump);
    return () => {
      vv.removeEventListener("resize", bump);
      vv.removeEventListener("scroll", bump);
    };
  }, []);

  // Place it centred over the selection, above it (below on touch screens, where the system's
  // own copy/look-up menu sits above), flipping when there's no room and staying on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { box } = picked;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // The part of the screen that's visible: clear of the notch, and above an open keyboard.
    const safe = safeInsets();
    const vv = window.visualViewport;
    const minY = (vv?.offsetTop ?? 0) + safe.top + EDGE;
    const maxY = (vv ? vv.offsetTop + vv.height : window.innerHeight) - safe.bottom - EDGE;
    const minX = safe.left + EDGE;
    const maxX = window.innerWidth - safe.right - EDGE;
    const above = box.top - GAP - h;
    const below = box.bottom + GAP;
    const fitsAbove = above >= minY;
    const fitsBelow = below + h <= maxY;
    const preferBelow = window.matchMedia("(pointer: coarse)").matches;
    let top = preferBelow ? (fitsBelow ? below : fitsAbove ? above : below) : fitsAbove ? above : fitsBelow ? below : above;
    top = Math.max(Math.min(top, maxY - h), minY);
    const left = Math.max(Math.min((box.left + box.right) / 2 - w / 2, maxX - w), minX);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "visible";
  }, [picked, mode, viewTick]);

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
      className="fixed z-30 max-w-[calc(100vw-1rem-env(safe-area-inset-left)-env(safe-area-inset-right))] animate-in rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/8 duration-150 fade-in zoom-in-95"
    >
      {mode === "actions" ? (
        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 pointer-coarse:gap-x-2 short:gap-x-1">
          <div className="flex items-center gap-1 pointer-coarse:gap-2 short:gap-1" role="group" aria-label="Highlight">
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Highlight ${c}`}
                title={`Highlight ${c}`}
                onClick={() => onHighlight(c)}
                className="grid size-9 cursor-pointer place-items-center rounded-lg transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:size-11"
              >
                <span className="size-4 rounded-full ring-1 ring-black/10" style={{ background: SWATCH[c] }} />
              </button>
            ))}
          </div>
          <span aria-hidden className="mx-1 h-5 w-px bg-border max-[400px]:hidden" />
          <div className="flex items-center gap-1 pointer-coarse:gap-2 short:gap-1">
            <Action label="Note" onClick={() => typeInto("note")} />
            <Action label="Explain" onClick={() => onAsk("explain")} />
            {short ? <Action label="Define" onClick={() => onAsk("define")} /> : <Action label="Simplify" onClick={() => onAsk("simplify")} />}
            <Action label="Ask" onClick={() => typeInto("ask")} />
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
            placeholder={mode === "note" ? "Add a note" : "Ask about this passage"}
            aria-label={mode === "note" ? "Note" : "Question"}
            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <IconBtn type="submit" tone="primary" label={mode === "note" ? "Save note" : "Ask"} disabled={!text.trim()}>
            {mode === "note" ? <Check /> : <ArrowUp />}
          </IconBtn>
        </form>
      )}
    </div>
  );
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
        "pointer-coarse:h-11",
      )}
    >
      {label}
    </button>
  );
}
