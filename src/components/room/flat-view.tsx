"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Headphones, Highlighter, LogOut, MessageCircleQuestionMark, NotebookPen, Plus, ScanText, ScrollText, Search, Trash2 } from "lucide-react";
import { ReviewDesk } from "@/components/shelf/review-desk";
import { cn } from "@/lib/utils";
import { useCoverTone } from "./covers";
import { useMedia, type LibraryProps } from "./library";
import { duration, pct, progressLabel, readLabel, toShelfBook, type PreviewPara, type ShelfBook } from "./model";
import { Cover, PaperFade, Pill, PreviewText, ViewToggle, bookFacts, readHref, useHandoff, type Fact } from "./ui";
import { useExtras, usePreview } from "./use-book-details";

const FACT_ICONS: Record<string, typeof Headphones> = {
  audio: Headphones,
  ai: ScanText,
  highlights: Highlighter,
  notes: NotebookPen,
  lookedUp: Search,
  questions: MessageCircleQuestionMark,
  recap: ScrollText,
};

/**
 * The flat library: a shelf of spines and the chosen book's details. Phones (upright or sideways)
 * open a book as a full page.
 */
export function FlatView(p: LibraryProps & { notice?: string | null }) {
  const { books, uploads, busy, error, addBooks, addAudio, remove, signOut, view, setView, canRoom, notice } = p;
  const narrow = useMedia("(max-width: 767px)");
  // A sideways phone: wide enough for a row, too short for the desktop shelf and a 280px cover.
  const short = useMedia("(orientation: landscape) and (max-height: 500px)");
  const phone = narrow || short;
  const layout: DetailLayout = short ? "row" : narrow ? "stack" : "wide";
  const [picked, setPicked] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const handoff = useHandoff();
  const selectedId = books?.some((b) => b._id === picked) ? picked : (books?.[0]?._id ?? null);
  const extras = useExtras(selectedId);
  const preview = usePreview(selectedId);
  const shelf = useMemo(
    () => (books ?? []).map((b) => toShelfBook(b, uploads[b._id] ?? null, b._id === selectedId ? (extras ?? null) : null)),
    [books, uploads, selectedId, extras],
  );
  const selected = shelf.find((b) => b.id === selectedId) ?? null;
  const empty = books !== undefined && books.length === 0;
  const showSheet = phone && sheetOpen && !!selected;

  const choose = (id: string) => {
    setPicked(id);
    if (phone) setSheetOpen(true);
  };
  const detail = selected && (
    <BookDetail
      key={selected.id}
      book={selected}
      preview={preview}
      layout={layout}
      onStart={(listen) => handoff.go(readHref(selected.id, listen))}
      onAddAudio={() => addAudio(selected.id)}
      onRemove={async () => {
        setSheetOpen(false);
        await remove(selected.id);
      }}
    />
  );

  return (
    <div className="relative flex min-h-dvh w-full flex-col">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-2 pt-[max(8px,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-6 sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pl-[max(2rem,env(safe-area-inset-left))] short:pt-[max(8px,env(safe-area-inset-top))]">
        <div className="flex items-baseline gap-4">
          <span className="text-2xl font-semibold">Loam</span>
          <span className="sc-wide text-sm text-[var(--lib-muted)] max-sm:hidden">Library</span>
        </div>
        <div className="flex items-center gap-2">
          {!empty && books && (
            <Pill onClick={addBooks} disabled={busy} icon={<Plus aria-hidden />} aria-label={phone ? (busy ? "Shelving" : "Add a book") : undefined} round={phone}>
              {phone ? null : busy ? "Shelving…" : "Add a book"}
            </Pill>
          )}
          {canRoom && <ViewToggle view={view} onChange={setView} />}
          <Pill round aria-label="Sign out" title="Sign out" onClick={signOut} icon={<LogOut aria-hidden />} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 pt-6 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-10 sm:pr-[max(2rem,env(safe-area-inset-right))] sm:pl-[max(2rem,env(safe-area-inset-left))] short:pt-4 short:pb-[max(2rem,env(safe-area-inset-bottom))]">
        {notice && <p className="mb-6 text-base text-[var(--lib-muted)]">{notice}</p>}
        {error && (
          <p role="alert" className="mb-6 text-base text-[#f0b0a6]">
            {error}
          </p>
        )}

        {empty && (
          <button
            type="button"
            onClick={addBooks}
            className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--lib-line-strong)] px-6 py-16 text-center transition-colors duration-200 hover:border-[var(--lib-brass)] hover:bg-[var(--lib-surface)] sm:py-24"
          >
            <span className="text-2xl font-semibold">{busy ? "Shelving…" : "Your shelf is empty"}</span>
            <span className="text-base text-[var(--lib-muted)]">
              <span className="pointer-coarse:hidden">Drop an EPUB here, or </span>
              <span className="text-[var(--lib-brass)] underline underline-offset-4">
                <span className="pointer-coarse:hidden">choose one</span>
                <span className="hidden pointer-coarse:inline">Choose an EPUB</span>
              </span>
            </span>
          </button>
        )}

        {!empty && (
          <div className="mx-auto max-w-2xl md:mx-0">
            <ReviewDesk />
          </div>
        )}

        {shelf.length > 0 && (
          <>
            {phone && selected && <DeskCard book={selected} onOpen={() => setSheetOpen(true)} onStart={(l) => handoff.go(readHref(selected.id, l))} />}
            <ShelfStrip books={shelf} selectedId={selectedId} onPick={choose} phone={phone} />
            {phone && <Settling books={shelf} onPick={choose} />}
            {!phone && <div className="mt-12">{detail}</div>}
          </>
        )}
      </main>

      {showSheet && <Sheet onClose={() => setSheetOpen(false)}>{detail}</Sheet>}
      <PaperFade on={handoff.leaving} />
    </div>
  );
}

/* ---------- the shelf ---------- */

function ShelfStrip({ books, selectedId, onPick, phone }: { books: ShelfBook[]; selectedId: string | null; onPick: (id: string) => void; phone: boolean }) {
  const audio = books.filter((b) => b.audio.kind === "ready").length;
  const annotated = books.filter((b) => b.ai.kind === "done").length;
  const listRef = useRef<HTMLUListElement>(null);
  // Arrow keys move between spines, like the room.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-spine]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <section aria-labelledby="shelf-h" className="mt-8 short:mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="shelf-h" className="sc-wide text-sm font-semibold text-[var(--lib-brass)]">
          Your shelf
        </h2>
        <p className="text-sm text-[var(--lib-muted)]">
          {books.length} {books.length === 1 ? "book" : "books"}
          {!phone && ` · ${audio} with synced audio · ${annotated} annotated`}
        </p>
      </div>
      <div
        className={cn("relative rounded-t-lg", phone && "-mr-[max(1rem,env(safe-area-inset-right))] -ml-[max(1rem,env(safe-area-inset-left))] rounded-none")}
        style={{ background: "radial-gradient(ellipse 60% 120% at 50% 0%, rgba(255,190,120,0.16), rgba(255,190,120,0) 70%), linear-gradient(#2a1a10, #1d120b)", boxShadow: "inset 0 1px 0 rgba(255,210,160,0.25), inset 0 12px 30px rgba(0,0,0,0.5)" }}
      >
        <div aria-hidden className="mx-6 h-[3px] rounded-b bg-[#ffc98a] opacity-55 shadow-[0_0_18px_4px_rgba(255,180,100,0.35)]" />
        <ul ref={listRef} onKeyDown={onKey} className={cn("shelf-scroll flex items-end gap-1 overflow-x-auto", phone ? "h-[236px] pt-7 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]" : "min-h-[320px] px-7 pt-10")}>
          <li aria-hidden className="mr-1.5 h-[150px] w-1.5 shrink-0 rounded-sm bg-[linear-gradient(90deg,#8a6a33,#d8b26a,#8a6a33)]" />
          {books.map((b) => (
            <li key={b.id} className="shrink-0">
              <Spine book={b} selected={b.id === selectedId} onPick={() => onPick(b.id)} scale={phone ? 560 : 760} />
            </li>
          ))}
          {!phone && (
            <li aria-hidden className="ml-auto flex shrink-0 items-end gap-5 pr-2">
              <span className="flex w-36 flex-col gap-0.5">
                <span className="h-3.5 -rotate-1 rounded-sm bg-[#7a2731]" />
                <span className="h-3 rounded-sm bg-[#5f7a5c]" />
                <span className="h-3 rounded-sm bg-[#d9c7a3]" />
              </span>
              <span className="h-20 w-12 rounded-[40%_40%_30%_30%/50%_50%_22%_22%] bg-[radial-gradient(ellipse_at_35%_30%,#e2d2b1,#b9a37c)]" />
            </li>
          )}
        </ul>
      </div>
      <div
        aria-hidden
        className={cn(
          "h-[18px] rounded-b bg-[linear-gradient(#6b4127,#4a2c19_60%,#2e1b0f)] shadow-[0_14px_30px_rgba(0,0,0,0.55)]",
          phone && "-mr-[max(1rem,env(safe-area-inset-right))] -ml-[max(1rem,env(safe-area-inset-left))] h-3 rounded-none",
        )}
      />
      {!phone && (
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--lib-muted)]">
          <Legend dot="bg-[#d6b06a]">Audiobook synced</Legend>
          <Legend dot="bg-[#9db59a]">Terms marked</Legend>
          <Legend dot="shadow-[inset_0_0_0_1.5px_#b9a88f]">Still syncing or finding terms</Legend>
        </ul>
      )}
    </section>
  );
}

function Legend({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {children}
    </li>
  );
}

const lastName = (author: string) => author.split(/[,;&]| and /)[0].trim().split(/\s+/).slice(-1)[0] ?? "";

function Spine({ book, selected, onPick, scale }: { book: ShelfBook; selected: boolean; onPick: () => void; scale: number }) {
  const tone = useCoverTone(book.coverUrl);
  const base = tone?.tone ?? book.cloth.cloth;
  const foil = tone ? (tone.ink === "#2b2119" ? "#3a2a1c" : "#e3cf9a") : book.cloth.foil;
  const w = Math.max(44, Math.min(72, Math.round(book.size.T * scale)));
  const h = Math.round(book.size.H * (scale + 20));
  const pips: string[] = [];
  if (book.audio.kind === "ready") pips.push("bg-[#d6b06a]");
  if (book.ai.kind === "done") pips.push("bg-[#9db59a]");
  if (["syncing", "queued", "uploading"].includes(book.audio.kind) || book.ai.kind === "running") pips.push("shadow-[inset_0_0_0_1.5px_currentColor]");
  return (
    <button
      type="button"
      data-spine
      aria-pressed={selected}
      aria-label={`${book.title}${book.author ? ` by ${book.author}` : ""}`}
      onClick={onPick}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-between rounded-[3px_3px_1px_1px] transition-[transform,box-shadow] duration-300 motion-reduce:transition-none",
        selected ? "-translate-y-4 shadow-[0_18px_24px_rgba(0,0,0,0.55),0_0_0_1px_rgba(214,176,106,0.65)]" : "shadow-[0_6px_10px_rgba(0,0,0,0.5)] hover:-translate-y-1.5",
      )}
      style={{ width: w, height: h, color: foil, background: `linear-gradient(90deg, rgba(0,0,0,0.38), rgba(255,255,255,0.07) 28%, rgba(0,0,0,0.12) 72%, rgba(0,0,0,0.42)), ${base}` }}
    >
      <span aria-hidden className="mt-4 block h-1 w-[72%] border-y border-current opacity-80 [border-top-width:2px]" />
      <span aria-hidden className="max-h-[62%] overflow-hidden text-base leading-none font-semibold text-ellipsis whitespace-nowrap [writing-mode:vertical-rl]">
        {book.title}
      </span>
      <span aria-hidden className="mb-3 flex flex-col items-center gap-2">
        {book.author && <span className="max-h-20 overflow-hidden text-xs italic opacity-90 [writing-mode:vertical-rl]">{lastName(book.author)}</span>}
        <span className="flex flex-col gap-1">
          {pips.map((c, i) => (
            <span key={i} className={cn("block size-[7px] rounded-full", c)} />
          ))}
        </span>
      </span>
    </button>
  );
}

/* ---------- phone extras ---------- */

function DeskCard({ book, onOpen, onStart }: { book: ShelfBook; onOpen: () => void; onStart: (listen: boolean) => void }) {
  return (
    <section aria-label="On the desk" className="mt-6 flex gap-4 rounded-2xl border border-[var(--lib-line)] bg-[var(--lib-surface)] p-4 short:mt-0">
      <button type="button" onClick={onOpen} aria-label={`Details for ${book.title}`} className="shrink-0 cursor-pointer self-start">
        <Cover book={book} small className="h-[96px] w-16 shadow-[0_10px_20px_rgba(0,0,0,0.5)]" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="sc-wide text-sm text-[var(--lib-brass)]">{book.started ? "On the desk" : "Newest"}</p>
        <p className="truncate text-base font-semibold">{book.title}</p>
        <p className="truncate text-sm text-[var(--lib-muted)]">{progressLabel(book)}</p>
        <Progress value={book.percent ?? 0} className="mt-2" />
        <div className="mt-3 flex gap-2">
          <Pill tone="primary" size="lg" className="flex-1 short:flex-none [&>.pill-face]:w-full short:[&>.pill-face]:px-8" onClick={() => onStart(false)}>
            {readLabel(book)}
          </Pill>
          {book.audio.kind === "ready" && <Pill tone="brass" round size="lg" aria-label="Listen to the audiobook" onClick={() => onStart(true)} icon={<Headphones aria-hidden />} />}
        </div>
      </div>
    </section>
  );
}

/** Books whose audio or terms are still being worked on. */
function Settling({ books, onPick }: { books: ShelfBook[]; onPick: (id: string) => void }) {
  const busy = books.filter((b) => ["uploading", "queued", "syncing"].includes(b.audio.kind) || b.ai.kind === "running" || b.ai.kind === "waiting");
  if (!busy.length) return null;
  return (
    <section aria-labelledby="settling-h" className="mt-8">
      <h2 id="settling-h" className="sc-wide mb-2 text-sm font-semibold text-[var(--lib-brass)]">
        Still settling in
      </h2>
      <ul className="flex flex-col gap-2">
        {busy.map((b) => {
          const facts = bookFacts(b);
          return (
            <li key={b.id}>
              <button type="button" onClick={() => onPick(b.id)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--lib-line)] bg-[var(--lib-surface)] px-3 py-2.5 text-left">
                <Cover book={b} small className="h-12 w-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold">{b.title}</span>
                  <span className="mt-1 flex gap-3 text-xs text-[var(--lib-muted)]">
                    {facts.slice(0, 2).map((f) => (
                      <span key={f.key} className="min-w-0 flex-1">
                        <span className="block truncate">{f.key === "audio" && b.audio.kind === "none" ? "No audiobook" : `${f.label}: ${f.value}`}</span>
                        <Progress value={(f.bar ?? (f.strong ? 100 : 0)) / 100} tone={f.tone} className="mt-1 h-0.5" />
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Book" className="fixed inset-0 z-30 overflow-y-auto bg-[var(--lib-bg)] pb-[max(24px,env(safe-area-inset-bottom))]">
      <div className="sticky top-0 z-10 flex items-center bg-[rgba(20,16,12,0.92)] pt-[max(4px,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur-sm">
        <Pill ref={ref} tone="quiet" onClick={onClose} icon={<ChevronLeft aria-hidden />} className="[&>.pill-face]:px-2">
          Shelf
        </Pill>
      </div>
      <div className="pt-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] short:pr-[max(1.5rem,env(safe-area-inset-right))] short:pl-[max(1.5rem,env(safe-area-inset-left))]">
        {children}
      </div>
    </div>
  );
}

/* ---------- one book ---------- */

function Progress({ value, tone = "var(--lib-ox)", className }: { value: number; tone?: string; className?: string }) {
  return (
    <div aria-hidden className={cn("h-1 rounded-full bg-[rgba(239,228,207,0.12)]", className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: tone }} />
    </div>
  );
}

function FactCard({ f }: { f: Fact }) {
  const Icon = FACT_ICONS[f.key] ?? ScanText;
  return (
    <li className={cn("rounded-xl border bg-[var(--lib-surface)] px-4 py-3", f.strong ? "border-[rgba(214,176,106,0.4)]" : "border-[var(--lib-line)]")}>
      <p className="sc flex items-center gap-2 text-sm text-[var(--lib-muted)]">
        <Icon aria-hidden className="size-4 shrink-0" style={{ color: f.tone }} />
        {f.label}
      </p>
      <p className="mt-1 text-base">{f.value}</p>
      {f.sub && <p className="mt-0.5 text-sm text-[var(--lib-muted)]">{f.sub}</p>}
      {f.bar !== undefined && <Progress value={f.bar / 100} tone={f.tone} className="mt-2 h-[3px]" />}
    </li>
  );
}

/** How a book's details are laid out: stacked (upright phone), cover beside text (sideways phone), or wide. */
type DetailLayout = "stack" | "row" | "wide";

function BookDetail({
  book,
  preview,
  layout,
  onStart,
  onAddAudio,
  onRemove,
}: {
  book: ShelfBook;
  preview: PreviewPara[] | undefined;
  layout: DetailLayout;
  onStart: (listen: boolean) => void;
  onAddAudio: () => void;
  onRemove: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const headingId = useId();
  const previewId = useId();
  const facts = bookFacts(book);
  const percent = book.percent ?? 0;
  const a = book.audio;
  const longPreview = (preview?.length ?? 0) > 4;
  const stack = layout === "stack";
  const row = layout === "row";

  return (
    <article aria-labelledby={headingId}>
      <div className={cn("flex", stack ? "flex-col items-center gap-6" : row ? "items-start gap-6" : "items-start gap-12")}>
        <div className={cn("shrink-0", stack ? "w-44" : row ? "w-32" : "w-[280px]")}>
          <Cover book={book} className={cn("aspect-[2/3] w-full", row ? "shadow-[0_16px_32px_rgba(0,0,0,0.6)]" : "shadow-[0_30px_60px_rgba(0,0,0,0.6)]")} />
        </div>

        <div className={cn("min-w-0 flex-1", stack && "w-full")}>
          <div className={cn(stack && "text-center")}>
            {book.author && <p className="sc-wide text-sm text-[var(--lib-brass)]">{book.author}</p>}
            <h1 id={headingId} className={cn("mt-1 leading-tight font-semibold", layout === "wide" ? "text-4xl" : "text-2xl")}>
              {book.title}
            </h1>
          </div>

          <div className={cn("flex flex-wrap gap-2", row ? "mt-4" : "mt-6", stack && "flex-col")}>
            <Pill tone="primary" size="lg" onClick={() => onStart(false)} className={cn(stack && "w-full [&>.pill-face]:w-full")}>
              {readLabel(book)}
            </Pill>
            {a.kind === "ready" && (
              <Pill tone="brass" size="lg" icon={<Headphones aria-hidden />} onClick={() => onStart(true)} className={cn(stack && "w-full [&>.pill-face]:w-full")}>
                {["Listen", duration(a.durationMs)].filter(Boolean).join(" · ")}
              </Pill>
            )}
            {preview && preview.length > 0 && (
              <a href={`#${previewId}`} className="sc inline-flex min-h-11 items-center justify-center px-3 text-base text-[var(--lib-brass)] underline-offset-4 hover:underline">
                Read the first pages
              </a>
            )}
          </div>

          <div className={cn("max-w-xl", row ? "mt-4" : "mt-6")}>
            <div className="flex justify-between gap-4 text-base">
              <span>{progressLabel(book)}</span>
              {book.started && <span className="text-[var(--lib-muted)] tabular-nums">{pct(percent)}</span>}
            </div>
            <Progress value={percent} className="mt-2" />
          </div>

          {book.description ? (
            <p className={cn("mt-6 max-w-[62ch] leading-relaxed text-[var(--lib-ink-soft)]", layout === "wide" ? "text-lg" : "text-base")}>{book.description}</p>
          ) : (
            <p className="mt-6 text-base text-[var(--lib-muted)] italic">No description.</p>
          )}

          <h2 className="sc-wide mt-8 mb-3 text-sm font-semibold text-[var(--lib-brass)]">What&apos;s here</h2>
          <ul className={cn("grid gap-2", stack ? "grid-cols-2" : row ? "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(200px,1fr))]")}>
            {facts.map((f) => (
              <FactCard key={f.key} f={f} />
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {confirm ? (
              <>
                <span className="text-base">Remove this book and its notes?</span>
                <Pill tone="danger" icon={<Trash2 aria-hidden />} onClick={() => void onRemove()}>
                  Remove
                </Pill>
                <Pill onClick={() => setConfirm(false)}>Keep</Pill>
              </>
            ) : (
              <>
                <Pill icon={<Headphones aria-hidden />} disabled={a.kind === "uploading"} onClick={onAddAudio}>
                  {a.kind === "uploading" ? `Uploading ${a.pct}%` : a.kind === "none" ? "Add audiobook" : "Replace audiobook"}
                </Pill>
                <Pill tone="quiet" icon={<Trash2 aria-hidden />} onClick={() => setConfirm(true)}>
                  Remove book
                </Pill>
              </>
            )}
          </div>
        </div>
      </div>

      <section id={previewId} aria-labelledby={`${previewId}-h`} className={cn("scroll-mt-6", row ? "mt-10 scroll-mt-14" : "mt-16")}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={`${previewId}-h`} className="sc-wide text-sm font-semibold text-[var(--lib-brass)]">
            Before you start
          </h2>
          <p className="text-sm text-[var(--lib-muted)]">
            The first pages.
            {preview?.some((p) => p.marked.some(Boolean)) && " Dotted words are terms Loam can explain."}
          </p>
        </div>
        <PreviewPaper paras={preview} long={longPreview} phone={layout !== "wide"} short={row} />
      </section>
    </article>
  );
}

function PreviewPaper({ paras, long, phone, short }: { paras: PreviewPara[] | undefined; long: boolean; phone: boolean; short: boolean }) {
  const [open, setOpen] = useState(false);
  const collapsed = long && !open;
  return (
    <div
      className={cn(
        "relative mt-4 max-w-[760px] overflow-hidden rounded bg-[var(--lib-paper)] text-[var(--lib-paper-ink)] shadow-[0_24px_60px_rgba(0,0,0,0.5)]",
        phone ? "-mx-1 px-6 pt-8 pb-8" : "px-[clamp(24px,6vw,72px)] pt-12 pb-10",
        // Sideways phones: a centred page of reading width, and a fold that leaves the "Show more" in view.
        short && "mx-auto max-w-[600px] px-10",
        collapsed && (short ? "max-h-[300px]" : phone ? "max-h-[520px]" : "max-h-[640px]"),
      )}
    >
      {paras === undefined ? (
        <p className="text-base italic opacity-70">Opening the first pages…</p>
      ) : paras.length === 0 ? (
        <p className="text-base italic opacity-70">No preview for this book.</p>
      ) : (
        <PreviewText paras={collapsed ? paras.slice(0, 6) : paras} className={cn("text-justify hyphens-auto", phone ? "text-base leading-[1.7]" : "text-lg leading-[1.75]")} />
      )}
      {collapsed && (
        <div className="absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-b from-[rgba(239,228,207,0)] to-[var(--lib-paper)] to-70% pb-5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="sc min-h-11 cursor-pointer rounded-full border border-[rgba(43,33,25,0.4)] bg-[var(--lib-paper)] px-5 text-base text-[var(--lib-paper-ink)] transition-colors duration-200 hover:border-[var(--lib-paper-ink)] focus-visible:outline-[var(--lib-paper-ink)]"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
