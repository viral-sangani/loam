"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Book as EpubBook, Contents, EpubCFI, Location, Rendition } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  getLocations,
  loadBookFile,
  loadPrefs,
  saveLocations,
  savePrefs,
  type Progress,
  type ReaderPrefs,
} from "@/lib/library";
import { INK, flatten, type Entry } from "./config";

/** Events coming from inside the book's iframe. Read through a ref so the latest handlers are used. */
export type FrameEvents = {
  key: (e: KeyboardEvent) => void;
  /** A tap, with its horizontal position as a fraction of the screen width (0 = left edge). */
  tap: (x: number) => void;
  activity: () => void;
  /** A click or tap on the text. Return true if it was handled (e.g. it hit an underlined term). */
  press: (contents: Contents, x: number, y: number) => boolean;
  /** A section was laid out in the book frame (also after a re-layout). */
  rendered: (contents: Contents) => void;
  /** A horizontal swipe: 1 = next page, -1 = previous. */
  swipe: (dir: 1 | -1) => void;
};

const SWIPE_PX = 40;
const TAP_PX = 10;
const TAP_MS = 350;

function applyPrefs(r: Rendition, p: ReaderPrefs) {
  r.themes.fontSize(`${p.fontSize}%`);
  r.themes.override("line-height", String(p.lineHeight), true);
  r.themes.override("color", INK[p.theme], true);
}

/**
 * Loads a book from the shelf into `viewRef`, and owns everything about the reading position:
 * the saved spot, the current chapter, progress, and text settings.
 */
export function useEpubReader(id: Id<"books">, viewRef: RefObject<HTMLDivElement | null>, events: RefObject<FrameEvents>) {
  const book = useQuery(api.books.get, { bookId: id });
  const saveProgressMutation = useMutation(api.books.saveProgress);
  const bookRef = useRef<EpubBook | null>(null);
  const rendRef = useRef<Rendition | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  const lastProgress = useRef<Progress | null>(null);
  /** The reading spot. Changes only when the reader moves, never because of re-layout. */
  const anchorRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const pendingChapter = useRef<number | null>(null);
  const stickyChapter = useRef<{ idx: number; anchor: string | null } | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [toc, setToc] = useState<Entry[]>([]);
  const [chapterIdx, setChapterIdx] = useState(-1);
  const [pagesLeft, setPagesLeft] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);

  const prefsRef = useRef(prefs);
  const chapterRef = useRef(chapterIdx);
  useEffect(() => {
    prefsRef.current = prefs;
    chapterRef.current = chapterIdx;
  }, [prefs, chapterIdx]);

  // Progress is saved to Convex at most every couple of seconds while paging.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (lastProgress.current) void saveProgressMutation({ bookId: id, progress: lastProgress.current }).catch(() => {});
  }, [id, saveProgressMutation]);
  const saveSoon = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 1500);
  }, [flush]);

  const updatePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
    const p = { ...prefsRef.current, ...patch };
    prefsRef.current = p;
    setPrefs(p);
    savePrefs(p);
    const r = rendRef.current;
    if (!r) return;
    const cfi = anchorRef.current ?? r.location?.start?.cfi;
    applyPrefs(r, p);
    if (cfi && (patch.fontSize || patch.lineHeight)) void r.display(cfi);
  }, []);

  const next = useCallback(() => {
    movedRef.current = true;
    void rendRef.current?.next();
  }, []);
  const prev = useCallback(() => {
    movedRef.current = true;
    void rendRef.current?.prev();
  }, []);
  /** Show a position (a CFI or an href), e.g. where the audio is. Counts as the reader moving. */
  const show = useCallback((target: string) => {
    movedRef.current = true;
    return rendRef.current?.display(target);
  }, []);
  const jumpTo = useCallback((i: number) => {
    const target = entriesRef.current[i];
    if (!target) return;
    movedRef.current = true;
    pendingChapter.current = i;
    void rendRef.current?.display(target.href);
  }, []);
  const goChapter = useCallback((dir: 1 | -1) => jumpTo(chapterRef.current + dir), [jumpTo]);

  const missing = book === null;
  const epub = book?.epub;
  const epubUrl = book?.epubUrl;
  // Where the book was left, captured once: later progress saves must not re-position the reader.
  const savedCfi = useRef<string | null>(null);
  useEffect(() => {
    if (book && savedCfi.current === null) savedCfi.current = book.progress?.cfi ?? "";
  }, [book]);

  useEffect(() => {
    if (missing) setStatus("missing"); // eslint-disable-line react-hooks/set-state-in-effect -- mirrors the query result
  }, [missing]);

  useEffect(() => {
    if (!epub || !epubUrl) return;
    let cancelled = false;
    let locating: Promise<unknown> | null = null;

    (async () => {
      const data = await loadBookFile(epub, epubUrl);
      if (cancelled) return;

      const mod = await import("epubjs");
      const cfiTool: EpubCFI = new mod.EpubCFI();
      const book = mod.default(data);
      bookRef.current = book;

      const rendition = book.renderTo(viewRef.current!, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        minSpreadWidth: 1100,
        allowScriptedContent: false,
      });
      rendRef.current = rendition;

      // Once a page's fonts finish loading the text re-flows; put the reader back on their spot.
      rendition.hooks.content.register(async (contents: Contents) => {
        await contents.addStylesheet(`${window.location.origin}/fonts/literata.css`);
        const doc = contents.document;
        await Promise.all([doc.fonts.load('1em "Literata"'), doc.fonts.load('italic 1em "Literata"')]).catch(() => {});
        await doc.fonts.ready;
        if (cancelled) return;
        events.current.rendered(contents);
        const anchor = anchorRef.current;
        if (!anchor || movedRef.current) return;
        if (new mod.EpubCFI(anchor).spinePos === contents.sectionIndex) void rendition.display(anchor);
      });
      rendition.themes.default({
        body: {
          "font-family": '"Literata", Georgia, serif !important',
          background: "transparent !important",
          "text-rendering": "optimizeLegibility",
          "-webkit-font-smoothing": "antialiased",
          "hanging-punctuation": "first",
          "-webkit-tap-highlight-color": "transparent",
        },
        "p, li, blockquote, div, span": {
          "font-family": "inherit !important",
          "line-height": "inherit !important",
          color: "inherit !important",
        },
        a: { color: "inherit !important", "text-decoration-color": "rgba(120,100,70,.4) !important" },
        "::selection": { background: "rgba(122,140,80,.28)" },
        img: { "max-width": "100% !important", "max-height": "90vh !important", "object-fit": "contain" },
        // Painted with the CSS Custom Highlight API, so the book's markup (and its CFIs) never change.
        "::highlight(loam-word)": { "background-color": "rgba(122,140,80,.32)", color: "inherit" },
        "::highlight(loam-term)": {
          "text-decoration": "underline dotted rgba(176,112,64,.85) 1.5px",
          "text-underline-offset": "3px",
        },
      });
      applyPrefs(rendition, prefsRef.current);

      const nav = await book.loaded.navigation;
      await book.ready;
      if (cancelled) return;
      const entries: Entry[] = flatten(nav.toc).flatMap((t) => {
        const [path, hash] = t.href.split("#");
        const s = book.spine.get(path);
        return s ? [{ ...t, spine: s.index, hash: hash || null }] : [];
      });
      entriesRef.current = entries;
      setToc(entries);

      /**
       * Current chapter = last TOC entry that starts at or before the end of the visible page.
       * Handles EPUBs where several chapters share one file (entries with #anchors).
       */
      const findChapter = (loc: Location): number => {
        const section = loc.start.index;
        const contents = (rendition.getContents() as unknown as Contents[]).find((c) => c.sectionIndex === section);
        let best = -1;
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.spine < section) best = i;
          else if (e.spine === section) {
            if (!e.hash) best = i;
            else {
              const el = contents?.document.getElementById(e.hash);
              if (!el) continue;
              if (cfiTool.compare(contents!.cfiFromNode(el), loc.end.cfi) <= 0) best = i;
            }
          } else break;
        }
        return best;
      };

      rendition.on("relocated", (loc: Location) => {
        if (movedRef.current || !anchorRef.current) {
          anchorRef.current = loc.start.cfi;
          movedRef.current = false;
        }
        const cfi = anchorRef.current;
        if (pendingChapter.current !== null) {
          stickyChapter.current = { idx: pendingChapter.current, anchor: cfi };
          pendingChapter.current = null;
        }
        const sticky = stickyChapter.current;
        const pct = book.locations.length() ? book.locations.percentageFromCfi(cfi) : null;
        const ci = sticky && sticky.anchor === cfi ? sticky.idx : findChapter(loc);
        const nextEntry = entries[ci + 1];
        // "pages left" is only meaningful when the next chapter starts in a different file
        const left =
          !nextEntry || nextEntry.spine !== loc.end.index || !nextEntry.hash
            ? Math.max(0, loc.end.displayed.total - loc.end.displayed.page)
            : null;
        setChapterIdx(ci);
        setPercent(pct);
        setPagesLeft(left);
        lastProgress.current = { cfi, percent: pct, chapter: entries[ci]?.label ?? null };
        saveSoon();
      });

      // Input from inside the iframe: keys, mouse activity, clicks, swipes and taps.
      rendition.on("keydown", (e: KeyboardEvent) => events.current.key(e));
      rendition.on("mousemove", () => events.current.activity());
      let lastTouch = 0;
      rendition.on("click", (e: MouseEvent, contents: Contents) => {
        if (Date.now() - lastTouch < 800) return; // the click that follows a tap was handled on touchend
        events.current.press(contents, e.clientX, e.clientY);
      });
      let touch: { x: number; y: number; t: number } | null = null;
      rendition.on("touchstart", (e: TouchEvent) => {
        const p = e.changedTouches[0];
        touch = p ? { x: p.screenX, y: p.screenY, t: Date.now() } : null;
      });
      rendition.on("touchend", (e: TouchEvent, contents: Contents) => {
        const p = e.changedTouches[0];
        lastTouch = Date.now();
        if (!touch || !p) return;
        const dx = p.screenX - touch.x;
        const dy = p.screenY - touch.y;
        const quick = Date.now() - touch.t < TAP_MS;
        touch = null;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return events.current.swipe(dx < 0 ? 1 : -1);
        const selecting = !!e.view?.getSelection()?.toString();
        if (quick && Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX && !selecting) {
          if (events.current.press(contents, p.clientX, p.clientY)) return;
          events.current.tap(p.screenX / window.screen.width);
        }
      });

      anchorRef.current = savedCfi.current || null;
      await rendition.display(anchorRef.current || undefined);
      if (cancelled) return;
      setStatus("ready");

      // Percentages need a location index; cache it so it's computed once per book.
      const cached = await getLocations(id);
      if (cached) book.locations.load(cached);
      else {
        locating = book.locations.generate(1600);
        await locating;
        if (cancelled) return;
        void saveLocations(id, book.locations.save());
      }
      if (cancelled) return;
      const cur = anchorRef.current;
      if (cur) {
        const pct = book.locations.percentageFromCfi(cur);
        setPercent(pct);
        if (lastProgress.current) {
          lastProgress.current = { ...lastProgress.current, percent: pct };
          saveSoon();
        }
      }
    })().catch((err) => {
      console.error("[reader]", err);
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      flush();
      const book = bookRef.current;
      const rendition = rendRef.current;
      // epub.js keeps working after open (rendering start, location scan); tear down once it settles.
      void Promise.allSettled([book?.opened, locating]).then(() =>
        setTimeout(() => {
          rendition?.destroy();
          book?.destroy();
        }, 0),
      );
      rendRef.current = null;
      bookRef.current = null;
      anchorRef.current = null;
    };
  }, [id, epub, epubUrl, viewRef, events, next, prev, flush, saveSoon]);

  // Save the spot when the tab is hidden or closed (mobile browsers often skip unload).
  useEffect(() => {
    const hidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  return {
    meta: book ?? null,
    status,
    toc,
    chapterIdx,
    pagesLeft,
    percent,
    prefs,
    updatePrefs,
    next,
    prev,
    show,
    jumpTo,
    goChapter,
    flush,
    rendition: rendRef,
  };
}

export type EpubReader = ReturnType<typeof useEpubReader>;
