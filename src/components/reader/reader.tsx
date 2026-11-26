"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import type { Contents } from "epubjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { AudioBar } from "./audio-bar";
import { BriefPanel } from "./brief-panel";
import { IDLE_MS, type Panel } from "./config";
import { ContentsPanel } from "./contents-panel";
import { ProgressFooter } from "./progress-footer";
import { SettingsPanel } from "./settings-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TopBar } from "./top-bar";
import { useAudiobook } from "./use-audiobook";
import { useEpubReader, type FrameEvents } from "./use-epub-reader";
import { useReaderKeys } from "./use-reader-keys";
import { useTerms } from "./use-terms";

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
  const viewRef = useRef<HTMLDivElement>(null);
  const events = useRef<FrameEvents>({
    key: () => {},
    tap: () => {},
    activity: () => {},
    press: () => false,
    rendered: () => {},
    swipe: () => {},
  });
  const reader = useEpubReader(id, viewRef, events);
  const { meta, status, toc, chapterIdx, pagesLeft, percent, prefs, updatePrefs, next, prev, goChapter, jumpTo, flush } = reader;

  const [panel, setPanel] = useState<Panel | null>(null);
  const [termId, setTermId] = useState<Id<"terms"> | null>(null);
  const [listening, setListening] = useState(false);
  const [chrome, setChrome] = useState(true);
  const panelOpen = useRef(false);
  useEffect(() => {
    panelOpen.current = panel !== null || termId !== null;
  }, [panel, termId]);

  // The section on screen, for underlining its terms and highlighting the spoken word.
  const contentsRef = useRef<Contents | null>(null);
  const [contents, setContents] = useState<Contents | null>(null);

  const audio = useAudiobook(id, reader, contentsRef, viewRef);
  const openTerm = useCallback((t: Id<"terms">) => {
    setPanel(null);
    setTermId(t);
  }, []);
  const terms = useTerms(id, contents, openTerm);

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

  const togglePanel = useCallback((p: Panel) => {
    setTermId(null);
    setPanel((cur) => (cur === p ? null : p));
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    setTermId(null);
  }, []);
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
  const { press } = terms;
  useEffect(() => {
    events.current = {
      key: frameKey,
      tap: onTap,
      activity: poke,
      press,
      swipe: (dir) => (dir > 0 ? userNext() : userPrev()),
      rendered: (c) => {
        contentsRef.current = c;
        setContents(c);
        onRendered(c);
      },
    };
  }, [frameKey, onTap, poke, press, userNext, userPrev, onRendered]);

  const showChrome = chrome || panel !== null || termId !== null || status !== "ready";

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
      {termId && <BriefPanel key={termId} termId={termId} onClose={closePanel} />}
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
