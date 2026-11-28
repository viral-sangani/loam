"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Book as EpubBook, Contents, EpubCFI, Location, Rendition } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Pos } from "@/lib/anchors";
import { paragraphElements, wordRange } from "@/lib/book-text";
import {
  getLocations,
  loadPrefs,
  saveLocations,
  savePrefs,
  READER_THEMES,
  type Progress,
  type ReaderPrefs,
  type ReaderTheme,
} from "@/lib/library";
import { bookFile, type Handoff } from "@/lib/open-book";
import { INK, flatten, type Entry } from "./config";
import { paint, paragraphAt, paragraphsOf } from "./highlights";

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
  /** The page on screen changed (paging, a jump, or a re-layout). */
  relocated: () => void;
};

/**
 * Two pages side by side once the page area is wide enough, and always on a phone held sideways
 * (its short height makes one wide column of long lines hard to read). Matches the `short` variant.
 */
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";
const minSpreadWidth = () => (window.matchMedia(SHORT_LANDSCAPE).matches ? 480 : 1100);

const SWIPE_PX = 40;
const TAP_PX = 10;
const TAP_MS = 350;
const FLASH_MS = 1200;

const contentsOf = (r: Rendition, section: number) =>
  (r.getContents() as unknown as Contents[]).find((c) => c.sectionIndex === section);

/** Whether the reader has text selected in the book frame. */
const hasSelection = (c: Contents | undefined) => !!c && !(c.window.getSelection()?.isCollapsed ?? true);

/**
 * A CFI for the start of a paragraph. The section is loaded on its own (epub.js caches it for
 * rendering), so this works for sections that aren't on screen yet.
 */
async function paragraphCfi(book: EpubBook, pos: Pos): Promise<string | null> {
  const section = book.spine.get(pos.section);
  if (!section) return null;
  const root = (await (section.load(book.load.bind(book)) as unknown as Promise<Element>).catch(() => null)) as Element | null;
  const el = root && paragraphElements(root.ownerDocument)[pos.para];
  const range = el && wordRange(el, 0);
  if (!range) return null;
  range.collapse(true);
  return section.cfiFromRange(range);
}

/** The first paragraph on the page that starts at `cfi`. */
function pageParagraph(contents: Contents, cfi: string): number {
  try {
    const r = contents.range(cfi);
    const i = paragraphAt(contents, { node: r.startContainer, offset: r.startOffset });
    return i >= 0 ? i : Math.max(0, paragraphsOf(contents).length - 1);
  } catch {
    return 0;
  }
}

function applyPrefs(r: Rendition, p: ReaderPrefs) {
  r.themes.fontSize(`${p.fontSize}%`);
  r.themes.override("line-height", String(p.lineHeight), true);
  r.themes.override("color", INK[p.theme], true);
  // epub.js puts the selected theme's name on each section's <body>; the rules below key off it.
  r.themes.select(`loam-${p.theme}`);
}

/** Colours painted over the text, per theme. Washes stay light so the ink keeps its contrast. */
type Paint = {
  selection: string;
  word: string;
  flash: string;
  term: string;
  note: string;
  link: string;
  yellow: string;
  green: string;
  rose: string;
  blue: string;
};
const PAINT: Record<ReaderTheme, Paint> = {
  paper: {
    selection: "rgba(28,28,28,.13)",
    word: "rgba(28,28,28,.11)",
    flash: "rgba(28,28,28,.08)",
    term: "rgba(28,28,28,.55)",
    note: "rgba(28,28,28,.7)",
    link: "rgba(28,28,28,.4)",
    yellow: "rgba(245,200,40,.32)",
    green: "rgba(96,168,88,.24)",
    rose: "rgba(232,96,112,.2)",
    blue: "rgba(72,136,224,.2)",
  },
  sepia: {
    selection: "rgba(122,140,80,.28)",
    word: "rgba(122,140,80,.32)",
    flash: "rgba(122,140,80,.3)",
    term: "rgba(176,112,64,.85)",
    note: "rgba(176,112,64,.6)",
    link: "rgba(120,100,70,.4)",
    yellow: "rgba(226,184,52,.34)",
    green: "rgba(128,160,84,.32)",
    rose: "rgba(214,112,112,.3)",
    blue: "rgba(96,146,206,.3)",
  },
  night: {
    selection: "rgba(170,190,130,.26)",
    word: "rgba(170,190,130,.3)",
    flash: "rgba(226,220,200,.12)",
    term: "rgba(222,160,110,.75)",
    note: "rgba(222,160,110,.7)",
    link: "rgba(226,217,201,.4)",
    yellow: "rgba(226,184,52,.3)",
    green: "rgba(128,170,84,.3)",
    rose: "rgba(224,112,112,.3)",
    blue: "rgba(96,150,216,.32)",
  },
};

/** Rules for the book frame: one block per theme, scoped by the class epub.js puts on <body>. */
function themeRules() {
  const rules: Record<string, Record<string, string>> = {};
  const on = (t: ReaderTheme, sel: string) => `body.loam-${t}${sel}, body.loam-${t} ${sel}`;
  // Plain rules first: a browser without ::highlight() rejects those, and epub.js stops at the first rejection.
  for (const t of READER_THEMES) {
    rules[`body.loam-${t} a`] = { "text-decoration-color": `${PAINT[t].link} !important` };
    rules[on(t, "::selection")] = { background: PAINT[t].selection };
  }
  for (const t of READER_THEMES) {
    const c = PAINT[t];
    const wash = (bg: string) => ({ "background-color": bg, color: "inherit" });
    // Painted with the CSS Custom Highlight API, so the book's markup (and its CFIs) never change.
    rules[on(t, "::highlight(loam-word)")] = wash(c.word);
    rules[on(t, "::highlight(loam-term)")] = {
      "text-decoration": `underline dotted ${c.term} 1.5px`,
      "text-underline-offset": "3px",
    };
    rules[on(t, "::highlight(loam-mark-yellow)")] = wash(c.yellow);
    rules[on(t, "::highlight(loam-mark-green)")] = wash(c.green);
    rules[on(t, "::highlight(loam-mark-rose)")] = wash(c.rose);
    rules[on(t, "::highlight(loam-mark-blue)")] = wash(c.blue);
    rules[on(t, "::highlight(loam-mark-note)")] = { "text-decoration": `underline ${c.note} 1.5px`, "text-underline-offset": "4px" };
    // A selection kept while its note or question is typed (the frame's own selection is lost on focus).
    rules[on(t, "::highlight(loam-picked)")] = wash(c.selection);
    rules[on(t, "::highlight(loam-flash)")] = wash(c.flash);
  }
  return rules;
}

/**
 * Loads a book from the library into `viewRef`, and owns everything about the reading position:
 * the saved spot, the current chapter, progress, and text settings. `start`, if given, opens the
 * book at that paragraph instead of the saved spot. `handoff` (from the library) lets the file
 * load and the page lay out before the book's query answers.
 */
export function useEpubReader(
  id: Id<"books">,
  viewRef: RefObject<HTMLDivElement | null>,
  events: RefObject<FrameEvents>,
  start: Pos | null = null,
  handoff: Handoff | null = null,
) {
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
  /** A paragraph jumped to: it becomes the reading spot on the next relocation, rather than the page start. */
  const pendingAnchor = useRef<string | null>(null);
  const startRef = useRef(start);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [toc, setToc] = useState<Entry[]>([]);
  const [chapterIdx, setChapterIdx] = useState(-1);
  const [pagesLeft, setPagesLeft] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  /** The first paragraph visible on the page. */
  const [position, setPosition] = useState<Pos | null>(null);

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

  /** Show a paragraph and briefly light it up, e.g. a citation in an answer. Counts as the reader moving. */
  const goTo = useCallback(async (pos: Pos): Promise<boolean> => {
    const r = rendRef.current;
    const book = bookRef.current;
    if (!r || !book) return false;
    const cfi = await paragraphCfi(book, pos);
    if (!cfi || rendRef.current !== r) return false;
    movedRef.current = true;
    pendingAnchor.current = cfi;
    await r.display(cfi);
    const contents = contentsOf(r, pos.section);
    const el = contents && paragraphsOf(contents)[pos.para];
    if (contents && el) {
      const range = contents.document.createRange();
      range.selectNodeContents(el);
      clearTimeout(flashTimer.current);
      paint(contents, "loam-flash", [range]);
      flashTimer.current = setTimeout(() => paint(contents, "loam-flash", []), FLASH_MS);
    }
    return true;
  }, []);

  const missing = book === null;
  const epub = book?.epub ?? handoff?.epub;
  const epubUrl = book?.epubUrl ?? handoff?.epubUrl;
  const urlRef = useRef(epubUrl);
  useEffect(() => {
    if (epubUrl) urlRef.current = epubUrl;
  }, [epubUrl]);
  // Where the book was left, captured once: later progress saves must not re-position the reader.
  const savedCfi = useRef<string | null>(null);
  const cfiWaiters = useRef<(() => void)[]>([]);
  const knownCfi = book ? (book.progress?.cfi ?? "") : (handoff?.cfi ?? null);
  useEffect(() => {
    if (knownCfi === null || savedCfi.current !== null) return;
    savedCfi.current = knownCfi;
    cfiWaiters.current.splice(0).forEach((fn) => fn());
  }, [knownCfi]);

  useEffect(() => {
    if (missing) setStatus("missing"); // eslint-disable-line react-hooks/set-state-in-effect -- mirrors the query result
  }, [missing]);

  useEffect(() => {
    const url = urlRef.current;
    if (!epub || !url) return;
    let cancelled = false;
    let locating: Promise<unknown> | null = null;

    (async () => {
      const [data, mod] = await Promise.all([bookFile(epub, url), import("epubjs")]);
      if (cancelled) return;

      const cfiTool: EpubCFI = new mod.EpubCFI();
      const book = mod.default(data);
      bookRef.current = book;

      const rendition = book.renderTo(viewRef.current!, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        minSpreadWidth: minSpreadWidth(),
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
        a: { color: "inherit !important" },
        img: { "max-width": "100% !important", "max-height": "90vh !important", "object-fit": "contain" },
        ...themeRules(),
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
          anchorRef.current = pendingAnchor.current ?? loc.start.cfi;
          movedRef.current = false;
        }
        pendingAnchor.current = null;
        const contents = contentsOf(rendition, loc.start.index);
        if (contents) {
          const p = { section: loc.start.index, para: pageParagraph(contents, loc.start.cfi) };
          setPosition((cur) => (cur && cur.section === p.section && cur.para === p.para ? cur : p));
        }
        events.current.relocated();
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
      // A press that only clears a selection, or that ends one, is not a tap on the text.
      let selectedAtDown = false;
      rendition.on("mousedown", (_e: MouseEvent, contents: Contents) => {
        selectedAtDown = hasSelection(contents);
      });
      rendition.on("click", (e: MouseEvent, contents: Contents) => {
        if (Date.now() - lastTouch < 800) return; // the click that follows a tap was handled on touchend
        if (selectedAtDown || hasSelection(contents)) return;
        events.current.press(contents, e.clientX, e.clientY);
      });
      let touch: { x: number; y: number; t: number } | null = null;
      rendition.on("touchstart", (e: TouchEvent, contents: Contents) => {
        const p = e.changedTouches[0];
        touch = p ? { x: p.screenX, y: p.screenY, t: Date.now() } : null;
        selectedAtDown = hasSelection(contents);
      });
      rendition.on("touchend", (e: TouchEvent, contents: Contents) => {
        const p = e.changedTouches[0];
        lastTouch = Date.now();
        if (!touch || !p) return;
        const dx = p.screenX - touch.x;
        const dy = p.screenY - touch.y;
        const quick = Date.now() - touch.t < TAP_MS;
        touch = null;
        // With text selected, drags adjust the selection and taps dismiss it.
        if (selectedAtDown || hasSelection(contents)) return;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return events.current.swipe(dx < 0 ? 1 : -1);
        if (quick && Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX) {
          if (events.current.press(contents, p.clientX, p.clientY)) return;
          events.current.tap(p.screenX / window.screen.width);
        }
      });

      if (savedCfi.current === null) await new Promise<void>((r) => cfiWaiters.current.push(r));
      if (cancelled) return;
      anchorRef.current = savedCfi.current || null;
      const opened = startRef.current && (await goTo(startRef.current));
      if (!opened) await rendition.display(anchorRef.current || undefined);
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
  }, [id, epub, viewRef, events, next, prev, flush, saveSoon, goTo]);

  // Turning a phone sideways switches to two pages (and back); then return to the reading spot,
  // since changing the page layout moves the text.
  useEffect(() => {
    const mq = window.matchMedia(SHORT_LANDSCAPE);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      const r = rendRef.current;
      if (!r) return;
      r.spread("auto", minSpreadWidth());
      clearTimeout(timer);
      // epub.js re-lays out on its own (debounced) resize as well; settle after both.
      timer = setTimeout(() => {
        const cfi = anchorRef.current ?? r.location?.start?.cfi;
        if (cfi) void r.display(cfi);
      }, 350);
    };
    mq.addEventListener("change", changed);
    return () => {
      mq.removeEventListener("change", changed);
      clearTimeout(timer);
    };
  }, []);

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
    position,
    goTo,
    flush,
    rendition: rendRef,
  };
}

export type EpubReader = ReturnType<typeof useEpubReader>;
