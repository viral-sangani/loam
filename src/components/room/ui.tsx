"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { LampFloor, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration, pct, type PreviewPara, type ShelfBook } from "./model";

/* ---------- pills ---------- */

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "brass" | "danger" | "quiet";
  icon?: ReactNode;
  /** Icon-only: a round 36px face; give it an aria-label. */
  round?: boolean;
  size?: "md" | "lg";
  ref?: Ref<HTMLButtonElement>;
};

/**
 * The one button shape in the library: a 36px (or 44px, `lg`) pill in small capitals, inside a
 * hit area at least 44px tall. Icons are always 16px.
 */
export function Pill({ tone = "default", icon, round, size = "md", className, children, type = "button", ref, ...rest }: PillProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("pill group inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center disabled:cursor-default disabled:opacity-50", className)}
      {...rest}
    >
      <span
        className={cn(
          "pill-face inline-flex items-center justify-center gap-2 rounded-full border text-base whitespace-nowrap transition-colors duration-200 [&_svg]:size-4 [&_svg]:shrink-0",
          size === "lg" ? "h-11" : "h-9",
          round ? (size === "lg" ? "w-11" : "w-9") : "px-4",
          tone === "default" && "sc border-[var(--lib-line-strong)] bg-[var(--lib-glass)] text-[var(--lib-ink)] group-hover:border-[rgba(239,228,207,0.6)] group-hover:bg-[rgba(30,20,14,0.85)]",
          tone === "quiet" && "sc border-transparent text-[var(--lib-muted)] group-hover:text-[var(--lib-ink)]",
          tone === "primary" && "sc border-transparent bg-[var(--lib-brass-fill)] font-semibold text-[var(--lib-on-brass)] group-hover:bg-[#d4ab62]",
          tone === "brass" && "sc border-[rgba(214,176,106,0.7)] bg-[var(--lib-glass)] text-[#e7c983] group-hover:border-[#e7c983]",
          tone === "danger" && "sc border-[rgba(224,122,110,0.6)] bg-[rgba(60,16,14,0.7)] text-[#f0b0a6] group-hover:border-[#f0b0a6]",
        )}
      >
        {icon}
        {children}
      </span>
    </button>
  );
}

/** Room / List switch, remembered per browser. */
export function ViewToggle({ view, onChange }: { view: "room" | "list"; onChange: (v: "room" | "list") => void }) {
  return (
    <div role="group" aria-label="Library view" className="inline-flex min-h-11 items-center">
      <span className="inline-flex h-9 items-center rounded-full border border-[var(--lib-line-strong)] bg-[var(--lib-glass)] p-0.5">
        {(
          [
            ["room", "Room", <LampFloor key="i" aria-hidden />],
            ["list", "List", <LayoutList key="i" aria-hidden />],
          ] as const
        ).map(([v, label, icon]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onChange(v)}
            className={cn(
              "sc inline-flex h-8 min-w-10 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-base transition-colors duration-200 [&_svg]:size-4",
              view === v ? "bg-[rgba(239,228,207,0.14)] text-[var(--lib-ink)]" : "text-[var(--lib-muted)] hover:text-[var(--lib-ink)]",
            )}
          >
            {icon}
            <span className="max-sm:sr-only">{label}</span>
          </button>
        ))}
      </span>
    </div>
  );
}

/* ---------- covers ---------- */

/** A drawn cloth cover for books whose EPUB has none (and as a stand-in while a cover loads). */
export function ClothCover({ book, className, small }: { book: ShelfBook; className?: string; small?: boolean }) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-[3px_6px_6px_3px]", className)}
      style={{
        background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px), radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.06), rgba(0,0,0,0.35)), ${book.cloth.cloth}`,
        color: book.cloth.foil,
      }}
    >
      <div
        className={cn("absolute flex flex-col items-center justify-center text-center", small ? "inset-1.5 gap-1 border p-1" : "inset-4 gap-4 border-2 p-6")}
        style={{ borderColor: book.cloth.foil }}
      >
        <div className={cn("line-clamp-4 font-semibold [text-shadow:0_1px_1px_rgba(0,0,0,0.5)]", small ? "text-[9px] leading-tight" : "text-2xl leading-tight")}>{book.title}</div>
        {!small && (
          <>
            <div aria-hidden className="w-20 border-t border-current" />
            <div className="line-clamp-2 text-base italic">{book.author}</div>
          </>
        )}
      </div>
    </div>
  );
}

export function Cover({ book, className, small }: { book: ShelfBook; className?: string; small?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!book.coverUrl || failed === book.coverUrl) return <ClothCover book={book} className={className} small={small} />;
  return (
    <div className={cn("relative overflow-hidden rounded-[3px_6px_6px_3px] bg-[var(--lib-surface)]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={book.coverUrl} alt="" className="size-full object-cover" onError={() => setFailed(book.coverUrl)} />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[8%] bg-gradient-to-r from-black/35 to-transparent" />
    </div>
  );
}

/* ---------- facts ---------- */

export type Fact = { key: string; label: string; value: string; sub?: string; bar?: number; tone: string; strong?: boolean };

/** What's known about a book, honestly: audio, terms, marks, recap. Shared by the list and the room's hidden summary. */
export function bookFacts(b: ShelfBook): Fact[] {
  const a = b.audio;
  const audio: Fact =
    a.kind === "ready"
      ? { key: "audio", label: "Audiobook", value: ["Synced", duration(a.durationMs)].filter(Boolean).join(" · "), sub: a.coverage !== null ? `${pct(a.coverage)} of the text follows the audio` : undefined, bar: a.coverage !== null ? a.coverage * 100 : undefined, tone: "#d6b06a", strong: true }
      : a.kind === "syncing"
        ? { key: "audio", label: "Audiobook", value: `Syncing · ${a.pct}%`, bar: a.pct, tone: "#d6b06a" }
        : a.kind === "queued"
          ? { key: "audio", label: "Audiobook", value: "Waiting to sync", bar: 0, tone: "#d6b06a" }
          : a.kind === "uploading"
            ? { key: "audio", label: "Audiobook", value: `Uploading · ${a.pct}%`, bar: a.pct, tone: "#d6b06a" }
            : a.kind === "error"
              ? { key: "audio", label: "Audiobook", value: "Sync failed", sub: "Add the audio files again to retry", tone: "#e07a6e" }
              : { key: "audio", label: "Audiobook", value: "None", tone: "#d6b06a" };
  const ai = b.ai;
  const terms: Fact =
    ai.kind === "done"
      ? { key: "ai", label: "Terms", value: ai.terms === null ? "Marked" : `${ai.terms} marked`, sub: ai.terms ? "Dotted words open an explanation" : undefined, tone: "#9db59a", strong: true }
      : ai.kind === "running"
        ? { key: "ai", label: "Terms", value: `Finding terms · ${ai.pct}%`, bar: ai.pct, tone: "#9db59a" }
        : ai.kind === "error"
          ? { key: "ai", label: "Terms", value: "Failed", tone: "#e07a6e" }
          : { key: "ai", label: "Terms", value: "Waiting", tone: "#9db59a" };
  const x = b.extras;
  const count = (n: number | undefined, one: string, many: string) => (n === undefined ? "…" : n === 0 ? "None yet" : `${n} ${n === 1 ? one : many}`);
  return [
    audio,
    terms,
    { key: "highlights", label: "Highlights", value: count(x?.highlights, "highlight", "highlights"), tone: "#e0aa45" },
    { key: "notes", label: "Notes", value: count(x?.notes, "note", "notes"), tone: "#8fae8b" },
    { key: "lookedUp", label: "Looked up", value: count(x?.lookedUp, "term", "terms"), tone: "#d0848b" },
    { key: "questions", label: "Questions", value: count(x?.questions, "question", "questions"), tone: "#b9a88f" },
    { key: "recap", label: "Story so far", value: x === null ? "…" : x.recap ? "Recap ready" : "None yet", tone: "#efe4cf" },
  ];
}

/* ---------- preview text ---------- */

/** Consecutive words joined into runs, so a several-word term is marked as one. */
function runs(p: PreviewPara) {
  const out: { text: string; marked: boolean }[] = [];
  p.words.forEach((w, i) => {
    const last = out[out.length - 1];
    if (last && last.marked === p.marked[i]) last.text += " " + w;
    else out.push({ text: w, marked: p.marked[i] });
  });
  return out;
}

/** The opening paragraphs as text; a short first paragraph is the chapter heading. */
export function PreviewText({ paras, className }: { paras: PreviewPara[]; className?: string }) {
  const heading = paras.length > 1 && paras[0].words.length <= 8 ? paras[0].words.join(" ") : null;
  const body = heading ? paras.slice(1) : paras;
  return (
    <div className={className}>
      {heading && <p className="mb-6 text-center text-2xl italic">{heading}</p>}
      {body.map((p, i) => (
        <p key={`${p.section}:${p.para}`} style={{ textIndent: i ? "1.6em" : 0 }}>
          {runs(p).map((r, j) => (
            <span key={j}>
              {j > 0 && " "}
              {r.marked ? <span className="term">{r.text}</span> : r.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/* ---------- hand-off to the reader ---------- */

/**
 * Leaving for the reader: fade the screen to the reader's white paper, then navigate, so no walnut
 * or lamplight shows on the way in.
 */
export function useHandoff() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const go = useCallback(
    (href: string, settleMs = 0) => {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      router.prefetch(href);
      timers.current.push(
        setTimeout(() => setLeaving(true), reduced ? 0 : settleMs),
        setTimeout(() => router.push(href), reduced ? 0 : settleMs + 300),
      );
    },
    [router],
  );
  return { leaving, go };
}

export function PaperFade({ on }: { on: boolean }) {
  return <div aria-hidden className="loam-paper-fade" data-on={on} />;
}

export const readHref = (id: string, listen = false) => `/read/${id}${listen ? "?listen=1" : ""}`;
