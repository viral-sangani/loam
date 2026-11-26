"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Ellipsis, Headphones, LogOut, Plus, Trash2, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import { ReviewDesk } from "@/components/shelf/review-desk";
import { cn } from "@/lib/utils";
import { createRoom, type RoomController, type RoomState } from "./engine";
import { useMedia, useViewport, type LibraryProps } from "./library";
import { duration, progressLabel, readLabel, statusLine, toShelfBook, type ShelfBook } from "./model";
import { PaperFade, Pill, PreviewText, ViewToggle, bookFacts, readHref, useHandoff } from "./ui";
import { useExtras, usePreview } from "./use-book-details";

const INITIAL: RoomState = { ready: false, stage: "room", bookId: null, face: "front", cardOut: false, spread: 0, spreads: 0, hover: null, zone: null, overflow: 0 };

/** Waits (briefly) for Literata so the covers and pages aren't drawn in a fallback font. */
function fontsReady() {
  const want = ['400 32px "Literata"', '600 32px "Literata"', '700 32px "Literata"', 'italic 400 32px "Literata"'];
  const load = Promise.all(want.map((f) => document.fonts.load(f))).catch(() => {});
  return Promise.race([load, new Promise((r) => setTimeout(r, 2500))]);
}

function hintFor(rs: RoomState, book: ShelfBook | null, opts: { empty: boolean; touch: boolean; busy: boolean; due: number }) {
  if (opts.busy) return "Putting the book on the shelf…";
  if (rs.stage === "room" || rs.stage === "shelf") {
    if (opts.empty) return "The shelf is empty. Add an EPUB to begin.";
    if (rs.zone === "review") return `Today's review: ${opts.due} ${opts.due === 1 ? "card" : "cards"}. Click to open it.`;
    if (rs.stage === "room") return opts.touch ? "Tap a spine to take it down." : "Hover a spine to see the book. Click to take it down.";
    return opts.touch ? "Tap a spine to take it down." : "Click a spine to take it down. Arrow keys move along the shelf.";
  }
  if (!book) return "";
  if (rs.stage === "open") {
    const dotted = book.ai.kind === "done" && !!book.ai.terms;
    return `${opts.touch ? "Tap" : "Click"} a page to turn it.${dotted ? " Dotted words are terms Loam can explain." : ""}`;
  }
  const turn = opts.touch ? "Drag to turn it over." : "Drag or scroll to turn it over.";
  switch (rs.face) {
    case "front":
      return turn;
    case "spine":
      return "Keep turning. The blurb is on the back.";
    case "back":
      return rs.cardOut ? "Your reading card: progress, marks and Loam's stamp." : `The blurb and audiobook. ${opts.touch ? "Tap" : "Click"} the card to pull it out.`;
    case "edge": {
      const x = book.extras;
      return x && x.highlights + x.notes + x.lookedUp > 0 ? "Tabs on the fore-edge: amber highlights, sage notes, rose looked-up terms." : "No highlights, notes or looked-up terms yet.";
    }
    default:
      return turn;
  }
}

export function RoomView(p: LibraryProps & { onFallback: (reason: "webgl" | "lost") => void }) {
  const { books, uploads, busy, error, addBooks, addAudio, remove, signOut, setView, onFallback } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomController | null>(null);
  const [engineOn, setEngineOn] = useState(false);
  const [rs, setRs] = useState<RoomState>(INITIAL);
  const [more, setMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const touch = useMedia("(pointer: coarse)");
  const narrow = useMedia("(max-width: 639px)");
  const vp = useViewport();
  const handoff = useHandoff();
  const review = useQuery(api.review.today, {});
  const due = review?.due ?? 0;

  const focusId = rs.bookId ?? rs.hover?.id ?? null;
  const extras = useExtras(focusId);
  const preview = usePreview(rs.bookId);

  const shelfBooks = useMemo(
    () => (books ?? []).map((b) => toShelfBook(b, uploads[b._id] ?? null, b._id === focusId ? (extras ?? null) : null)),
    [books, uploads, focusId, extras],
  );
  const held = shelfBooks.find((b) => b.id === rs.bookId) ?? null;
  const hovered = rs.hover ? (shelfBooks.find((b) => b.id === rs.hover!.id) ?? null) : null;
  const empty = books !== undefined && books.length === 0;
  const inHand = (rs.stage === "held" || rs.stage === "open") && !!held;

  /* the engine */
  const onFallbackRef = useRef(onFallback);
  const listenRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);
  useEffect(() => {
    let live = true;
    void fontsReady().then(() => {
      if (!live || !canvasRef.current) return;
      const engine = createRoom(canvasRef.current, {
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        onChange: (s) => live && setRs(s),
        onError: (kind) => live && onFallbackRef.current(kind),
        onReview: () => live && setReviewOpen(true),
        onListen: (id) => listenRef.current(id),
      });
      engineRef.current = engine;
      if (engine) setEngineOn(true);
    });
    return () => {
      live = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (engineOn) engineRef.current?.setBooks(shelfBooks);
  }, [engineOn, shelfBooks]);
  useEffect(() => {
    if (engineOn && rs.bookId) engineRef.current?.setPreview(rs.bookId, preview);
  }, [engineOn, rs.bookId, preview]);
  useEffect(() => {
    if (engineOn) engineRef.current?.setReview(due);
  }, [engineOn, due]);
  useEffect(() => {
    appRef.current?.focus({ preventScroll: true });
  }, []);

  const call = useCallback(<K extends keyof RoomController>(k: K, ...args: Parameters<RoomController[K]>) => {
    const e = engineRef.current;
    if (!e) return;
    (e[k] as (...a: Parameters<RoomController[K]>) => unknown)(...args);
  }, []);

  const start = useCallback(
    (id: string, listen = false) => {
      const ms = engineRef.current?.settleOnPage() ?? 0;
      handoff.go(readHref(id, listen), ms);
    },
    [handoff],
  );
  useEffect(() => {
    listenRef.current = (id) => start(id, true);
  }, [start]);

  // Leaving the book closes its menus.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  if (menuFor !== rs.bookId) {
    setMenuFor(rs.bookId);
    setMore(false);
    setConfirming(false);
  }

  const back = useCallback(() => {
    if (reviewOpen) return setReviewOpen(false);
    if (confirming || more) {
      setConfirming(false);
      setMore(false);
      return;
    }
    call("go", rs.stage === "open" ? "held" : rs.stage === "held" ? "shelf" : "room");
  }, [call, confirming, more, reviewOpen, rs.stage]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (handoff.leaving) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-review]") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      if (e.key === "Escape") setReviewOpen(false);
      return;
    }
    const onApp = t === appRef.current;
    if (e.key === "Escape") {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const d = e.key === "ArrowRight" ? 1 : -1;
      e.preventDefault();
      if (rs.stage === "open") call("flip", d);
      else if (rs.stage === "held") call("turn", d);
      else engineRef.current?.hoverStep(d);
    } else if (e.key === "Enter" && onApp) {
      e.preventDefault();
      if ((rs.stage === "room" || rs.stage === "shelf") && rs.hover) call("pick", rs.hover.id);
      else if (rs.stage === "held") call("go", "open");
      else if (rs.stage === "open" && held) start(held.id);
    }
  };

  const hint = hintFor(rs, held, { empty, touch, busy, due });
  const audioReady = held?.audio.kind === "ready";
  const hoverPos = rs.hover && hovered ? { left: Math.max(16, Math.min(vp.w - 296, rs.hover.x + 18)), top: Math.max(76, Math.min(vp.h - 180, rs.hover.y - 124)) } : null;

  return (
    <div className="fixed inset-0 z-10 overflow-hidden bg-[var(--lib-scene)] select-none" onKeyDown={onKey}>
      <div
        ref={appRef}
        tabIndex={0}
        role="application"
        aria-roledescription="3D reading room"
        aria-label="Reading room. Arrow keys move along the shelf or turn the book, Enter takes a book down or opens it, Escape steps back."
        aria-describedby="room-hint"
        className="absolute inset-0 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--lib-brass)]"
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full touch-none" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-700"
        style={{ background: "radial-gradient(ellipse 70% 72% at 50% 46%, rgba(7,4,3,0) 40%, rgba(7,4,3,0.82) 100%)", opacity: inHand ? 1 : 0.45 }}
      />

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start gap-x-2 px-4 pt-[max(8px,env(safe-area-inset-top))] sm:px-6">
        <span className="mr-2 inline-flex min-h-11 items-center text-2xl leading-none font-semibold">Loam</span>
        <nav aria-label="Room" className="pointer-events-auto flex flex-wrap items-center gap-2 max-sm:order-last max-sm:w-full">
          {inHand && rs.stage === "open" && (
            <Pill onClick={() => call("go", "held")} icon={<X aria-hidden />}>
              Close the book
            </Pill>
          )}
          {inHand && (
            <Pill onClick={() => call("go", "shelf")} icon={<ChevronLeft aria-hidden />}>
              Back to shelf
            </Pill>
          )}
          {rs.stage !== "room" && <Pill onClick={() => call("go", "room")}>Zoom out</Pill>}
        </nav>
        <div className="pointer-events-auto ml-auto flex items-center justify-end gap-2">
          {!empty && books && (
            <Pill onClick={addBooks} disabled={busy} icon={<Plus aria-hidden />} round={narrow} aria-label={narrow ? "Add a book" : undefined}>
              {narrow ? null : busy ? "Shelving…" : "Add a book"}
            </Pill>
          )}
          {due > 0 && (
            <Pill onClick={() => setReviewOpen(true)} aria-haspopup="dialog">
              Review · {due}
            </Pill>
          )}
          <ViewToggle view="room" onChange={setView} />
          <Pill round aria-label="Sign out" title="Sign out" onClick={signOut} icon={<LogOut aria-hidden />} />
        </div>
      </header>

      {/* the book in hand */}
      {inHand && held && rs.stage === "held" && !rs.cardOut && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(max(8px,env(safe-area-inset-top))+56px)] z-20 mx-auto max-w-[min(640px,calc(100%-32px))] text-center max-sm:hidden">
          {held.author && <p className="sc-wide truncate text-sm text-[var(--lib-brass)]">{held.author}</p>}
          <p className="truncate text-lg italic">{held.title}</p>
        </div>
      )}

      {/* spine label */}
      {hoverPos && hovered && !inHand && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 w-[280px] rounded-xl border border-[var(--lib-line)] bg-[rgba(16,10,7,0.9)] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={hoverPos}
        >
          <p className="line-clamp-2 text-base leading-snug font-semibold">{hovered.title}</p>
          {hovered.author && <p className="mt-1 truncate text-sm text-[var(--lib-ink-soft)] italic">{hovered.author}</p>}
          <p className="sc mt-2 text-sm leading-snug text-[var(--lib-brass)]">{statusLine(hovered)}</p>
        </div>
      )}

      {/* empty shelf */}
      {empty && rs.ready && (
        <div className="absolute inset-x-4 bottom-[max(72px,calc(env(safe-area-inset-bottom)+64px))] z-20 mx-auto max-w-sm rounded-2xl border border-[var(--lib-line)] bg-[rgba(16,10,7,0.88)] px-6 py-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          <h1 className="text-2xl font-semibold">Your shelf is empty</h1>
          <p className="mt-2 text-base text-[var(--lib-muted)]">Add an EPUB to put it on the shelf.</p>
          <div className="mt-6 flex justify-center">
            <Pill tone="primary" size="lg" onClick={addBooks} disabled={busy} icon={<Plus aria-hidden />}>
              {busy ? "Shelving…" : "Add a book"}
            </Pill>
          </div>
          <p className="mt-2 text-sm text-[var(--lib-muted)] pointer-coarse:hidden">or drop a file anywhere</p>
        </div>
      )}

      {/* actions and the hint line */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-4 pb-[max(12px,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="pointer-events-auto rounded-full border border-[rgba(224,122,110,0.5)] bg-[rgba(40,12,10,0.85)] px-4 py-2 text-sm text-[#f0b0a6]">
            {error}
          </p>
        )}
        {inHand && held && (
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2">
            {confirming ? (
              <>
                <span className="px-2 text-base">Remove this book and its notes?</span>
                <Pill
                  tone="danger"
                  icon={<Trash2 aria-hidden />}
                  onClick={() => {
                    setConfirming(false);
                    void remove(held.id);
                  }}
                >
                  Remove
                </Pill>
                <Pill onClick={() => setConfirming(false)}>Keep</Pill>
              </>
            ) : more ? (
              <>
                <Pill icon={<Headphones aria-hidden />} disabled={held.audio.kind === "uploading"} onClick={() => addAudio(held.id)}>
                  {held.audio.kind === "none" ? "Add audiobook" : "Replace audiobook"}
                </Pill>
                <Pill tone="danger" icon={<Trash2 aria-hidden />} onClick={() => setConfirming(true)}>
                  Remove book
                </Pill>
                <Pill onClick={() => setMore(false)}>Done</Pill>
              </>
            ) : (
              <>
                <Pill round aria-label={rs.stage === "open" ? "Previous pages" : "Turn left"} onClick={() => (rs.stage === "open" ? call("flip", -1) : call("turn", -1))} icon={<ChevronLeft aria-hidden />} />
                {rs.stage === "held" && <Pill onClick={() => call("go", "open")}>Read the first pages</Pill>}
                {rs.stage === "held" && rs.face === "back" && <Pill onClick={() => call("toggleCard")}>{rs.cardOut ? "Tuck the card in" : "Pull out the card"}</Pill>}
                <Pill tone="primary" onClick={() => start(held.id)}>
                  {readLabel(held)}
                </Pill>
                {audioReady && (
                  <Pill tone="brass" icon={<Headphones aria-hidden />} onClick={() => start(held.id, true)}>
                    {["Listen", held.audio.kind === "ready" ? duration(held.audio.durationMs) : null].filter(Boolean).join(" · ")}
                  </Pill>
                )}
                {(held.audio.kind === "none" || held.audio.kind === "uploading") && (
                  <Pill icon={<Headphones aria-hidden />} disabled={held.audio.kind === "uploading"} onClick={() => addAudio(held.id)}>
                    {held.audio.kind === "uploading" ? `Uploading ${held.audio.pct}%` : "Add audiobook"}
                  </Pill>
                )}
                <Pill round aria-label="More actions" onClick={() => setMore(true)} icon={<Ellipsis aria-hidden />} />
                <Pill round aria-label={rs.stage === "open" ? "Next pages" : "Turn right"} onClick={() => (rs.stage === "open" ? call("flip", 1) : call("turn", 1))} icon={<ChevronRight aria-hidden />} />
              </>
            )}
          </div>
        )}
        <p id="room-hint" aria-live="polite" className="max-w-[min(640px,100%)] text-center text-sm leading-snug text-[rgba(239,228,207,0.85)] [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
          {hint}
          {rs.overflow > 0 && ` ${rs.overflow} more ${rs.overflow === 1 ? "book is" : "books are"} in the list.`}
        </p>
      </div>

      {/* today's review, on the side table */}
      {reviewOpen && (
        <aside
          data-review
          role="dialog"
          aria-label="Today's review"
          className="absolute top-[calc(max(8px,env(safe-area-inset-top))+56px)] right-4 z-30 w-[min(420px,calc(100%-32px))] rounded-2xl border border-[var(--lib-line)] bg-[rgba(20,16,12,0.96)] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
        >
          <div className="flex justify-end">
            <Pill round aria-label="Close review" onClick={() => setReviewOpen(false)} icon={<X aria-hidden />} autoFocus />
          </div>
          <div className="px-2 pb-2 [&_section]:mb-0">
            {due > 0 ? <ReviewDesk /> : <p className="px-4 pb-4 text-base text-[var(--lib-muted)]">Nothing to review today.</p>}
          </div>
        </aside>
      )}

      {/* the same room in words, for screen readers */}
      <div className="sr-only">
        <h1>Loam library</h1>
        <ul aria-label="Shelf">
          {shelfBooks.map((b) => (
            <li key={b.id}>
              <button type="button" tabIndex={-1} onClick={() => call("pick", b.id)}>
                {`${b.title}${b.author ? ` by ${b.author}` : ""}. ${statusLine(b)}`}
              </button>
            </li>
          ))}
        </ul>
        {inHand && held && (
          <section aria-label="Book in hand">
            <h2>{held.title}</h2>
            {held.author && <p>{held.author}</p>}
            <p>{held.description ?? "No description."}</p>
            <p>Reading: {progressLabel(held)}</p>
            <ul>
              {bookFacts(held).map((f) => (
                <li key={f.key}>
                  {f.label}: {f.value}
                  {f.sub ? `. ${f.sub}` : ""}
                </li>
              ))}
            </ul>
            {rs.stage === "open" && preview && <PreviewText paras={preview} />}
          </section>
        )}
      </div>

      {!rs.ready && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--lib-scene)]">
          <div className="text-center">
            <div aria-hidden className="mx-auto mb-4 size-2.5 rounded-full bg-[#ffc98a] shadow-[0_0_40px_18px_rgba(255,170,90,0.35)]" />
            <p className="sc-wide text-sm text-[rgba(239,228,207,0.8)]">Lighting the lamp</p>
          </div>
        </div>
      )}
      <PaperFade on={handoff.leaving} />
    </div>
  );
}
