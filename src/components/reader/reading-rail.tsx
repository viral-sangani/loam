"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { SWATCH, markColor } from "./use-marks";

/** Sections laid end to end, each a slice of the book sized by its words (0..1). */
type Segment = { index: number; start: number; size: number; paragraphs: number };

/** Ticks closer than this (as a fraction of the book) share one mark, so a dense book stays a few hundred nodes. */
const BUCKETS = 500;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function layout(outline: { index: number; words: number; paragraphs: number }[]): Segment[] {
  const sorted = [...outline].filter((s) => s.paragraphs > 0).sort((a, b) => a.index - b.index);
  const total = sorted.reduce((n, s) => n + s.words, 0);
  if (!total) return [];
  let at = 0;
  return sorted.map((s) => {
    const seg = { index: s.index, start: at / total, size: s.words / total, paragraphs: s.paragraphs };
    at += s.words;
    return seg;
  });
}

/**
 * Where a paragraph falls in the whole book. Within a section we only know paragraph counts,
 * so paragraphs are treated as equally long; that's close enough at this scale.
 * A section with no stored text (an image page, say) sits at the start of the next one that has some.
 */
function fractionOf(segs: Segment[], pos: Pos) {
  const seg = segs.find((s) => s.index >= pos.section);
  if (!seg) return 1;
  if (seg.index !== pos.section) return seg.start;
  return seg.start + seg.size * clamp(pos.para / seg.paragraphs, 0, 1);
}

/** The paragraph at a point on the map: the inverse of `fractionOf`. */
function posAt(segs: Segment[], f: number): Pos {
  const seg = segs.find((s) => f < s.start + s.size) ?? segs[segs.length - 1];
  const local = seg.size ? (f - seg.start) / seg.size : 0;
  return { section: seg.index, para: clamp(Math.floor(local * seg.paragraphs), 0, seg.paragraphs - 1) };
}

/**
 * A minimap of the whole book along the right edge: sections sized by length, ticks for your
 * highlights and for the AI-marked terms, and where you are.
 * Hover to see the chapter, click or drag to travel there.
 *
 * Desktop and tablet only: on a phone the side margin is a sliver and the bottom already holds the
 * progress line and the player, so a second strip would crowd the page and steal taps meant for the text.
 */
export function ReadingRail({
  bookId,
  position,
  labels,
  onJump,
  visible,
}: {
  bookId: Id<"books">;
  /** The reader's paragraph. */
  position: Pos | null;
  /** Section index → chapter title, for the hover label. */
  labels?: Record<number, string>;
  onJump: (pos: Pos) => void;
  /** Follows the reader's chrome: hidden (and click-through) while reading undisturbed. */
  visible: boolean;
}) {
  const outline = useQuery(api.books.outline, { bookId });
  const terms = useQuery(api.books.termPositions, { bookId });
  const marks = useQuery(api.marks.list, { bookId });
  const segs = useMemo(() => (outline ? layout(outline) : []), [outline]);

  const markTicks = useMemo(() => {
    const seen = new Map<string, { f: number; color: string | null }>();
    for (const m of marks ?? []) {
      const f = fractionOf(segs, { section: m.anchor.section, para: m.anchor.startPara });
      seen.set(`${Math.round(f * BUCKETS)}:${m.color}`, { f, color: m.color });
    }
    return [...seen.values()];
  }, [marks, segs]);

  const termTicks = useMemo(() => {
    const seen = new Map<number, number>();
    for (const t of terms ?? []) {
      const f = fractionOf(segs, t);
      seen.set(Math.round(f * BUCKETS), f);
    }
    return [...seen.values()];
  }, [terms, segs]);

  // Labels belong to the section a chapter starts in; later sections without one continue it.
  const labelKeys = useMemo(
    () =>
      Object.keys(labels ?? {})
        .map(Number)
        .sort((a, b) => a - b),
    [labels],
  );
  const chapterOf = (section: number) => {
    let key: number | undefined;
    for (const k of labelKeys) if (k <= section) key = k;
    return key === undefined ? null : (labels?.[key] ?? null);
  };

  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  if (!segs.length) return null;

  const here = position ? fractionOf(segs, position) : null;
  const shown = visible || dragging;

  const fractionAt = (clientY: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    return r && r.height ? clamp((clientY - r.top) / r.height, 0, 0.99999) : 0;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setHover(fractionAt(e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // Touch has no hover; only show the label while a finger is down.
    if (dragging || e.pointerType === "mouse") setHover(fractionAt(e.clientY));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.pointerType !== "mouse") setHover(null);
    // Travel on release, not while dragging: each jump re-renders the book.
    onJump(posAt(segs, fractionAt(e.clientY)));
  };
  const onPointerCancel = () => {
    setDragging(false);
    setHover(null);
  };

  // Up/down step by section (the map is top-to-bottom); left/right stay page turns.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = position ? segs.findIndex((s) => s.index >= position.section) : 0;
    const atStart = !position || position.para === 0 || segs[cur]?.index !== position.section;
    const target: Record<string, number> = {
      ArrowDown: cur + 1,
      PageDown: cur + 1,
      ArrowUp: atStart ? cur - 1 : cur,
      PageUp: atStart ? cur - 1 : cur,
      Home: 0,
      End: segs.length - 1,
    };
    if (!(e.key in target)) return;
    e.preventDefault();
    e.stopPropagation(); // keep the reader's own arrow-key handling out of it
    const seg = segs[clamp(target[e.key], 0, segs.length - 1)];
    onJump({ section: seg.index, para: 0 });
  };

  const hoverPos = hover === null ? null : posAt(segs, hover);
  const hoverChapter = hoverPos && chapterOf(hoverPos.section);
  const hereChapter = position && chapterOf(position.section);
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const top = (f: number) => ({ top: `${f * 100}%` });

  return (
    <div
      role="slider"
      aria-label="Reading map"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={here === null ? 0 : Math.round(here * 100)}
      aria-valuetext={here === null ? undefined : [hereChapter, pct(here)].filter(Boolean).join(", ")}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={onKeyDown}
      data-dragging={dragging || undefined}
      className={cn(
        // A narrow hit strip at the very edge: the page-turn margin beside it stays clickable,
        // and while hidden the whole rail lets clicks through.
        "group fixed top-[calc(4.5rem+env(safe-area-inset-top))] right-[max(0.25rem,env(safe-area-inset-right))] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 hidden w-6 cursor-pointer touch-none justify-center outline-none select-none md:flex",
        // Sideways phones: the top bar is shorter, and the rail clears the notch when it's on the right.
        "short:top-16 short:bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
        "rounded-full focus-visible:ring-2 focus-visible:ring-ring/50",
        "motion-safe:transition-opacity motion-safe:duration-500",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div
        ref={trackRef}
        className="relative h-full w-[3px] motion-safe:transition-[width] group-hover:w-[5px] group-data-[dragging]:w-[5px]"
      >
        {segs.map((s) => {
          const read = here === null ? 0 : clamp((here - s.start) / s.size, 0, 1);
          return (
            <div
              key={s.index}
              className="absolute inset-x-0 overflow-hidden rounded-[1px] bg-foreground/12"
              // A 1px gap between sections, unless the section is too short to spare it.
              style={{ top: `${s.start * 100}%`, height: `max(1px, calc(${s.size * 100}% - 1px))` }}
            >
              {read > 0 && <div className="bg-muted-foreground/60" style={{ height: `${read * 100}%` }} />}
            </div>
          );
        })}

        {termTicks.map((f) => (
          <div key={`t${f}`} aria-hidden className="absolute right-full mr-[2px] h-px w-[3px] bg-muted-foreground/40" style={top(f)} />
        ))}
        {markTicks.map(({ f, color }) => (
          <div
            key={`m${f}:${color}`}
            aria-hidden
            className="absolute -inset-x-[3px] h-[2px] -translate-y-1/2 rounded-full bg-clay"
            // An unknown colour is dropped by the browser, leaving the clay default.
            style={{ ...top(f), backgroundColor: SWATCH[markColor(color)] }}
          />
        ))}

        {here !== null && (
          <div
            aria-hidden
            className="absolute -inset-x-[5px] h-[2px] -translate-y-1/2 rounded-full bg-foreground motion-safe:transition-[top] motion-safe:duration-300"
            style={top(here)}
          />
        )}

        {hover !== null && hoverPos && (
          <>
            <div aria-hidden className="absolute -inset-x-[4px] h-px bg-foreground" style={top(hover)} />
            <div
              aria-hidden
              className="pointer-events-none absolute right-full mr-3 flex max-w-64 -translate-y-1/2 items-baseline gap-2 rounded-md border border-border bg-popover px-2 py-1 whitespace-nowrap text-popover-foreground"
              style={top(hover)}
            >
              {hoverChapter && <span className="min-w-0 truncate text-xs">{hoverChapter}</span>}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct(hover)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
