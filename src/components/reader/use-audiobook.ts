"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { Contents } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { wordRange, wordSpans } from "@/lib/book-text";
import { isVisible, paint, paragraphsOf } from "./highlights";
import type { EpubReader } from "./use-epub-reader";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
const RATE_KEY = "loam:rate";

/** Timed words of one section: parallel arrays sorted by time, plus the raw start per word. */
type SectionTimes = { times: number[]; words: number[]; starts: number[] };

/** Cumulative word counts per paragraph of a rendered section, to turn a section word index into (paragraph, word). */
const countsCache = new WeakMap<Document, number[]>();
function wordOffsets(contents: Contents) {
  let cum = countsCache.get(contents.document);
  if (!cum) {
    cum = [0];
    for (const el of paragraphsOf(contents)) cum.push(cum[cum.length - 1] + wordSpans(el).length);
    countsCache.set(contents.document, cum);
  }
  return cum;
}

function locateWord(contents: Contents, index: number): Range | null {
  const cum = wordOffsets(contents);
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  const el = paragraphsOf(contents)[lo];
  return el ? wordRange(el, index - cum[lo]) : null;
}

/** Last index i with arr[i] <= x, or -1. */
function lastAtOrBefore(arr: number[], x: number) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Plays a book's audiobook and keeps the text in step with it: the spoken word is highlighted
 * and the page follows the narration, until the reader pages away on their own.
 */
export function useAudiobook(
  bookId: Id<"books">,
  reader: EpubReader,
  contentsRef: React.RefObject<Contents | null>,
  viewport: React.RefObject<HTMLDivElement | null>,
) {
  const convex = useConvex();
  const audio = reader.meta?.audio ?? null;
  const ready = audio?.status === "ready";
  const index = useQuery(api.books.timingIndex, ready ? { bookId } : "skip");
  const savePosition = useMutation(api.books.saveAudioPosition);

  const el = useRef<HTMLAudioElement | null>(null);
  const fileIdx = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const sections = useRef(new Map<number, SectionTimes | Promise<void>>());
  const current = useRef<{ section: number; word: number } | null>(null);
  const followSection = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(audio?.positionMs ?? 0);
  const [rate, setRateState] = useState(1);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  const files = audio?.files;
  const urls = useMemo(() => files?.map((f) => f.url ?? "") ?? [], [files]);
  const offsets = useMemo(() => {
    const out = [0];
    for (const f of files ?? []) out.push(out[out.length - 1] + (f.durationMs ?? 0));
    return out;
  }, [files]);
  const total = offsets[offsets.length - 1] || 0;

  useEffect(() => {
    try {
      const r = Number(localStorage.getItem(RATE_KEY));
      if (SPEEDS.includes(r as (typeof SPEEDS)[number])) setRateState(r); // eslint-disable-line react-hooks/set-state-in-effect -- restore preference
    } catch {
      /* ignore */
    }
  }, []);

  const globalMs = useCallback(() => {
    const a = el.current;
    return a ? offsets[fileIdx.current] + a.currentTime * 1000 : 0;
  }, [offsets]);

  // ---- section timings -----------------------------------------------------
  const loadSection = useCallback(
    (section: number) => {
      if (sections.current.has(section)) return;
      const p = convex.query(api.books.sectionTimings, { bookId, section }).then((starts) => {
        const times: number[] = [];
        const words: number[] = [];
        (starts ?? []).forEach((t, i) => {
          if (t >= 0 && (!times.length || t >= times[times.length - 1])) {
            times.push(t);
            words.push(i);
          }
        });
        sections.current.set(section, { times, words, starts: starts ?? [] });
      });
      sections.current.set(section, p);
    },
    [convex, bookId],
  );
  const timesOf = (section: number) => {
    const s = sections.current.get(section);
    return s && !(s instanceof Promise) ? s : null;
  };

  // ---- highlight + follow ----------------------------------------------------
  const showWord = useCallback(
    (section: number, word: number) => {
      const contents = contentsRef.current;
      if (!contents || contents.sectionIndex !== section) {
        if (followRef.current && followSection.current !== section) {
          followSection.current = section;
          const href = reader.rendition.current?.book.spine.get(section)?.href;
          if (href) void reader.show(href);
        }
        return;
      }
      followSection.current = null;
      const range = locateWord(contents, word);
      paint(contents, "loam-word", range ? [range] : []);
      if (range && followRef.current && viewport.current && !isVisible(contents, range, viewport.current)) {
        void reader.show(contents.cfiFromRange(range));
      }
    },
    [contentsRef, reader, viewport],
  );

  const sync = useCallback(() => {
    if (!index?.length) return;
    const t = globalMs();
    const i = lastAtOrBefore(
      index.map((s) => s.startMs),
      t,
    );
    const sec = index[i];
    if (!sec || t > sec.endMs + 4000) return;
    loadSection(sec.section);
    if (index[i + 1]) loadSection(index[i + 1].section);
    const times = timesOf(sec.section);
    if (!times) return;
    const w = lastAtOrBefore(times.times, t);
    if (w < 0 || t - times.times[w] > 4000) return;
    const word = times.words[w];
    const cur = current.current;
    if (cur && cur.section === sec.section && cur.word === word) return;
    current.current = { section: sec.section, word };
    showWord(sec.section, word);
  }, [index, globalMs, loadSection, showWord]);

  /** A section was (re)laid out: repaint the current word in it. */
  const onRendered = useCallback(
    (contents: Contents) => {
      const cur = current.current;
      if (cur && cur.section === contents.sectionIndex) showWord(cur.section, cur.word);
    },
    [showWord],
  );

  // ---- playback ----------------------------------------------------------------
  const persist = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - lastSaved.current < 10_000) return;
      lastSaved.current = now;
      void savePosition({ bookId, positionMs: Math.round(globalMs()) }).catch(() => {});
    },
    [savePosition, bookId, globalMs],
  );

  const seek = useCallback(
    (ms: number) => {
      const a = el.current;
      if (!a || !urls.length) return;
      const t = Math.max(0, total ? Math.min(ms, total - 500) : ms);
      const fi = Math.max(0, lastAtOrBefore(offsets.slice(0, -1), t));
      const local = (t - offsets[fi]) / 1000;
      if (fi !== fileIdx.current || !a.src) {
        fileIdx.current = fi;
        pendingSeek.current = local;
        a.src = urls[fi];
      } else if (a.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeek.current = local; // still loading: applied on loadedmetadata
      } else a.currentTime = local;
      setPosition(t);
      current.current = null;
    },
    [urls, offsets, total],
  );

  /** The time of the first narrated word on the page being read, if any. */
  const pageStartMs = useCallback(async (): Promise<number | null> => {
    const contents = contentsRef.current;
    const vp = viewport.current;
    if (!contents || !vp || !index?.length) return null;
    const section = contents.sectionIndex;
    loadSection(section);
    await sections.current.get(section);
    const times = timesOf(section);
    if (!times) return null;
    const cum = wordOffsets(contents);
    const paras = paragraphsOf(contents);
    for (let p = 0; p < paras.length; p++) {
      const spans = wordSpans(paras[p]);
      for (let w = 0; w < spans.length; w++) {
        const r = wordRange(paras[p], w);
        if (!r || !isVisible(contents, r, vp)) continue;
        for (let i = cum[p] + w; i < times.starts.length; i++) if (times.starts[i] >= 0) return times.starts[i];
        return null;
      }
    }
    return null;
  }, [contentsRef, viewport, index, loadSection]);

  const play = useCallback(async () => {
    const a = el.current;
    if (!a || !urls.length) return;
    if (!a.src) seek(position);
    // Start from the page being read, unless the narration is already on it.
    const cur = current.current;
    const contents = contentsRef.current;
    const onPage =
      cur && contents && viewport.current && cur.section === contents.sectionIndex
        ? (() => {
            const r = locateWord(contents, cur.word);
            return !!r && isVisible(contents, r, viewport.current!);
          })()
        : false;
    if (!onPage) {
      const start = await pageStartMs();
      if (start !== null) seek(start);
    }
    setFollow(true);
    followSection.current = null;
    a.playbackRate = rate;
    await a.play().catch(() => {});
  }, [urls, seek, position, contentsRef, viewport, pageStartMs, rate]);

  const pause = useCallback(() => el.current?.pause(), []);
  const toggle = useCallback(() => (playing ? pause() : void play()), [playing, pause, play]);
  const skip = useCallback((deltaMs: number) => seek(globalMs() + deltaMs), [seek, globalMs]);
  const setRate = useCallback((r: number) => {
    setRateState(r);
    if (el.current) el.current.playbackRate = r;
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {
      /* ignore */
    }
  }, []);
  /** The reader paged on their own: stop dragging them back to the narration. */
  const userMoved = useCallback(() => {
    if (playing) setFollow(false);
  }, [playing]);
  const resync = useCallback(() => {
    setFollow(true);
    followRef.current = true;
    followSection.current = null;
    const cur = current.current;
    if (cur) showWord(cur.section, cur.word);
  }, [showWord]);

  // One audio element for the whole session; files are swapped in as the timeline crosses them.
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    el.current = a;
    return () => {
      a.pause();
      a.removeAttribute("src");
      el.current = null;
    };
  }, []);

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    let raf = 0;
    let lastUi = 0;
    const loop = () => {
      const now = performance.now();
      if (now - lastUi > 250) {
        lastUi = now;
        setPosition(globalMs());
      }
      sync();
      persist();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setPosition(globalMs());
      persist(true);
    };
    const onMeta = () => {
      if (pendingSeek.current !== null) {
        a.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
      a.playbackRate = rate;
    };
    const onEnded = () => {
      if (fileIdx.current < urls.length - 1) {
        fileIdx.current += 1;
        a.src = urls[fileIdx.current];
        void a.play();
      }
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnded);
    if (!a.paused) raf = requestAnimationFrame(loop); // re-bound while playing (e.g. timings arrived)
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnded);
    };
  }, [globalMs, sync, persist, urls, rate]);

  // Lock-screen and headset controls.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !reader.meta) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: reader.meta.title, artist: reader.meta.author });
    navigator.mediaSession.setActionHandler("play", () => void play());
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("seekbackward", () => skip(-15_000));
    navigator.mediaSession.setActionHandler("seekforward", () => skip(30_000));
  }, [reader.meta, play, pause, skip]);

  return {
    available: !!urls.length,
    status: audio?.status ?? null,
    progress: audio?.progress ?? 0,
    synced: ready && !!index?.length,
    playing,
    position,
    total,
    rate,
    follow,
    toggle,
    skip,
    setRate,
    userMoved,
    resync,
    onRendered,
  };
}

export type Audiobook = ReturnType<typeof useAudiobook>;
