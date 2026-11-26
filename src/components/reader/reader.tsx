"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth } from "convex/react";
import type { Contents } from "epubjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import type { Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { AskPanel, useAskThread, type Passage } from "./ask-panel";
import { AudioBar } from "./audio-bar";
import { BookAskPanel } from "./book-ask-panel";
import { BriefPanel } from "./brief-panel";
import { IDLE_MS, type Panel } from "./config";
import { ContentsPanel } from "./contents-panel";
import { Lens, type AskKind } from "./lens";
import { MarkPanel } from "./mark-panel";
import { NotebookPanel } from "./notebook-panel";
import { ProgressFooter } from "./progress-footer";
import { ReadingRail } from "./reading-rail";
import { RecapNudge, RecapPanel } from "./recap-panel";
import { SettingsPanel } from "./settings-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TopBar } from "./top-bar";
import { useAudiobook } from "./use-audiobook";
import { useEpubReader, type FrameEvents } from "./use-epub-reader";
import { useMarks } from "./use-marks";
import { useReaderKeys } from "./use-reader-keys";
import { useSelection } from "./use-selection";
import { useTerms } from "./use-terms";

/** Panels about something in the text. Like the top-bar panels, only one is open at a time. */
type Detail = { kind: "term"; id: Id<"terms"> } | { kind: "mark"; id: Id<"marks"> } | { kind: "ask" };

/** A place in the book from the URL (`?s=<section>&p=<paragraph>`), e.g. from the daily review. */
function spotFrom(params: URLSearchParams): Pos | null {
  const s = Number(params.get("s"));
  const p = Number(params.get("p") ?? 0);
  return params.has("s") && Number.isInteger(s) && s >= 0 && Number.isInteger(p) && p >= 0 ? { section: s, para: p } : null;
}

export function Reader() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/");
  }, [isLoading, isAuthenticated, router]);
  if (!isAuthenticated) return null;
  return <BookReader />;
}

function BookReader() {
  const id = useParams<{ id: string }>().id as Id<"books">;
  const router = useRouter();
  const params = useSearchParams();
  const spot = useMemo(() => spotFrom(params), [params]);
  const [openAt] = useState(spot);
  const viewRef = useRef<HTMLDivElement>(null);
  const events = useRef<FrameEvents>({
    key: () => {},
    tap: () => {},
    activity: () => {},
    press: () => false,
    rendered: () => {},
    swipe: () => {},
    relocated: () => {},
  });
  const reader = useEpubReader(id, viewRef, events, openAt);
  const { meta, status, toc, chapterIdx, pagesLeft, percent, prefs, updatePrefs, next, prev, goChapter, jumpTo, goTo, position, flush } = reader;

  const [panel, setPanel] = useState<Panel | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [listening, setListening] = useState(false);
  const [chrome, setChrome] = useState(true);
  const panelOpen = useRef(false);
  useEffect(() => {
    panelOpen.current = panel !== null || detail !== null;
  }, [panel, detail]);

  // The section on screen, for underlining its terms and highlighting the spoken word.
  const contentsRef = useRef<Contents | null>(null);
  const [contents, setContents] = useState<Contents | null>(null);

  const audio = useAudiobook(id, reader, contentsRef, viewRef);
  const openDetail = useCallback((d: Detail) => {
    setPanel(null);
    setDetail(d);
  }, []);
  const openTerm = useCallback((t: Id<"terms">) => openDetail({ kind: "term", id: t }), [openDetail]);
  const openMark = useCallback((m: Id<"marks">) => openDetail({ kind: "mark", id: m }), [openDetail]);
  const terms = useTerms(id, contents, openTerm);
  const marks = useMarks(id, contents, openMark);
  const selection = useSelection(contents, viewRef);
  const asks = useAskThread(id);
  const { start: startAsk } = asks;
  const ask = useCallback(
    (passage: Passage, kind: AskKind, question?: string) => {
      startAsk(passage, kind, question);
      openDetail({ kind: "ask" });
    },
    [startAsk, openDetail],
  );

  // Paging on your own while the audio plays stops the page from following the narration.
  const { userMoved } = audio;
  const userNext = useCallback(() => {
    userMoved();
    next();
  }, [userMoved, next]);
  const userPrev = useCallback(() => {
    userMoved();
    prev();
  }, [userMoved, prev]);
  const userChapter = useCallback(
    (dir: 1 | -1) => {
      userMoved();
      goChapter(dir);
    },
    [userMoved, goChapter],
  );
  /** Show a paragraph (a citation, a note, a spot on the map); panels pass this as `onJump`. */
  const jump = useCallback(
    (pos: Pos) => {
      userMoved();
      void goTo(pos);
    },
    [userMoved, goTo],
  );

  // A spot in the URL opens the book there; a later link while the book is open jumps. Either way the
  // query is dropped, so reloading resumes where the reader is rather than at the link.
  useEffect(() => {
    if (status !== "ready" || !spot) return;
    if (spot !== openAt) jump(spot);
    window.history.replaceState(null, "", window.location.pathname);
  }, [status, spot, openAt, jump]);

  // ---- controls fade away while reading ---------------------------------
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleHide = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => !panelOpen.current && setChrome(false), IDLE_MS);
  }, []);
  const poke = useCallback(() => {
    setChrome(true);
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    if (status === "ready") scheduleHide();
    return () => clearTimeout(idleTimer.current);
  }, [status, scheduleHide]);
  useEffect(() => {
    window.addEventListener("mousemove", poke);
    return () => window.removeEventListener("mousemove", poke);
  }, [poke]);

  const { clear: clearSelection } = selection;
  const togglePanel = useCallback(
    (p: Panel) => {
      clearSelection();
      setDetail(null);
      setPanel((cur) => (cur === p ? null : p));
    },
    [clearSelection],
  );
  const closePanel = useCallback(() => {
    clearSelection();
    setPanel(null);
    setDetail(null);
  }, [clearSelection]);
  const { toggle: toggleAudio } = audio;
  const extraKeys = useMemo(
    () => ({
      a: () => setListening((l) => !l),
      k: () => {
        setListening(true);
        toggleAudio();
      },
    }),
    [toggleAudio],
  );
  const frameKey = useReaderKeys(
    { next: userNext, prev: userPrev, goChapter: userChapter, updatePrefs, prefs },
    togglePanel,
    closePanel,
    extraKeys,
  );

  // Taps on the page: left edge goes back, right edge goes forward, middle shows/hides controls.
  const onTap = useCallback(
    (x: number) => {
      if (x < 0.3) userPrev();
      else if (x > 0.7) userNext();
      else if (chrome) setChrome(false);
      else poke();
    },
    [userPrev, userNext, chrome, poke],
  );

  const { onRendered } = audio;
  const { press: pressTerm } = terms;
  const { press: pressMark } = marks;
  useEffect(() => {
    events.current = {
      key: frameKey,
      tap: onTap,
      activity: poke,
      // Underlined terms win over highlights where they overlap.
      press: (c, x, y) => pressTerm(c, x, y) || pressMark(c, x, y),
      swipe: (dir) => (dir > 0 ? userNext() : userPrev()),
      rendered: (c) => {
        contentsRef.current = c;
        setContents(c);
        onRendered(c);
      },
      relocated: clearSelection,
    };
  }, [frameKey, onTap, poke, pressTerm, pressMark, userNext, userPrev, onRendered, clearSelection]);

  // When the book was last opened, captured from the first load: saving progress soon moves it to now.
  const [lastOpened, setLastOpened] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (meta && lastOpened === undefined) setLastOpened(meta.openedAt); // eslint-disable-line react-hooks/set-state-in-effect -- captured once from the query
  }, [meta, lastOpened]);

  // Chapter names by section, for the reading map: each section takes its first contents entry.
  const chapterLabels = useMemo(() => {
    const out: Record<number, string> = {};
    for (const e of toc) out[e.spine] ??= e.label;
    return out;
  }, [toc]);

  const { picked } = selection;
  const openedMark = detail?.kind === "mark" ? marks.marks?.find((m) => m._id === detail.id) : undefined;
  const showChrome = chrome || panel !== null || detail !== null || status !== "ready";

  return (
    <div
      data-reader-theme={prefs.theme}
      className="reader-surface fixed inset-0 z-10 flex touch-manipulation flex-col overscroll-none bg-background text-foreground transition-colors"
    >
      <TopBar
        title={meta?.title}
        visible={showChrome}
        panel={panel}
        onToggle={togglePanel}
        listening={listening}
        onListen={() => setListening((l) => !l)}
        onBack={() => {
          flush();
          router.push("/");
        }}
      />

      <div className="relative flex-1 px-[max(1.25rem,6vw)] pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        <EdgeButton side="left" onClick={userPrev} />
        <div ref={viewRef} className="h-full w-full" />
        <EdgeButton side="right" onClick={userNext} />

        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            {status === "loading" && <p className="font-serif text-muted-foreground italic">Opening…</p>}
            {status === "missing" && (
              <p className="text-center text-sm text-muted-foreground">
                This book isn&apos;t on your shelf anymore.{" "}
                <Link href="/" className="text-primary underline underline-offset-4">
                  Back to shelf
                </Link>
              </p>
            )}
            {status === "error" && <p className="text-sm text-destructive">Couldn&apos;t open this book.</p>}
          </div>
        )}
      </div>

      {listening && status === "ready" ? (
        <AudioBar audio={audio} onClose={() => setListening(false)} />
      ) : (
        prefs.showProgress &&
        status === "ready" && <ProgressFooter chapter={toc[chapterIdx]?.label ?? null} pagesLeft={pagesLeft} percent={percent} />
      )}

      {panel === "toc" && (
        <ContentsPanel
          toc={toc}
          current={chapterIdx}
          onClose={closePanel}
          onPick={(i) => {
            userMoved();
            jumpTo(i);
            closePanel();
          }}
        />
      )}
      {panel === "type" && <SettingsPanel prefs={prefs} onChange={updatePrefs} onClose={closePanel} />}
      {panel === "keys" && <ShortcutsDialog onClose={closePanel} />}
      {panel === "notebook" && <NotebookPanel bookId={id} toc={toc} onJump={jump} onClose={closePanel} />}
      {panel === "ask" && (
        <BookAskPanel bookId={id} position={position} onJump={jump} onClose={closePanel} onSwitch={setPanel} />
      )}
      {panel === "recap" && <RecapPanel bookId={id} position={position} onJump={jump} onClose={closePanel} onSwitch={setPanel} />}
      {detail?.kind === "term" && <BriefPanel key={detail.id} termId={detail.id} onClose={closePanel} />}
      {openedMark && (
        <MarkPanel
          key={openedMark._id}
          mark={openedMark}
          onUpdate={marks.update}
          onRemove={marks.remove}
          onExplain={() => ask({ anchor: openedMark.anchor, quote: openedMark.quote }, "explain")}
          onClose={closePanel}
        />
      )}
      {detail?.kind === "ask" && <AskPanel asks={asks} onCite={jump} onClose={closePanel} />}

      {status === "ready" && (
        <ReadingRail
          bookId={id}
          position={position}
          labels={chapterLabels}
          onJump={jump}
          visible={showChrome && panel === null && detail === null}
        />
      )}
      {/* Offered when coming back to a book after a few days. */}
      {status === "ready" && panel === null && detail === null && (
        <RecapNudge openedAt={lastOpened} onOpen={() => setPanel("recap")} />
      )}

      {picked && (
        <Lens
          key={`${picked.anchor.startPara}.${picked.anchor.startWord}-${picked.anchor.endPara}.${picked.anchor.endWord}`}
          picked={picked}
          onHighlight={(color) => {
            void marks.create(picked.anchor, color);
            clearSelection();
          }}
          onNote={(note) => {
            void marks.create(picked.anchor, "yellow", note);
            clearSelection();
          }}
          onAsk={(kind, question) => {
            ask({ anchor: picked.anchor, quote: picked.quote }, kind, question);
            clearSelection();
          }}
          onFreeze={selection.freeze}
          onClose={clearSelection}
        />
      )}
    </div>
  );
}

/** Page-turn zones in the margins. On touch screens, tapping or swiping the text works too. */
function EdgeButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous page" : "Next page"}
      onClick={onClick}
      className={cn("group absolute inset-y-0 z-10 flex w-[max(1.25rem,6vw)] items-center justify-center", side === "left" ? "left-0" : "right-0")}
    >
      <Icon className="size-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}
