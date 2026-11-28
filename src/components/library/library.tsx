"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronDown, Headphones, LogOut, Plus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SignIn } from "@/components/auth/sign-in";
import { Btn, IconBtn, Segmented } from "@/components/reader/kit";
import { RoomLoader, SCENE } from "@/components/room/loader";
import { useLibraryView, type LibraryView } from "@/components/room/view-mode";
import "@/components/room/room.css";
import { ReviewDesk } from "@/components/shelf/review-desk";
import { useDescriptionBackfill } from "@/lib/describe";
import { loadPrefs, type ReaderTheme } from "@/lib/library";
import { handOff, warmBook } from "@/lib/open-book";
import { addAudiobook, addEpub } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { BookDetails } from "./book-details";
import { clearCachedBooks, readCachedBooks, saveCachedBooks } from "./cache";
import { audioLabel, audioState, progressLabel, readHref, termsLabel, type ListedBook } from "./model";

const THEME_COLOR: Record<ReaderTheme, string> = { paper: "#fcfcfa", sepia: "#efe6d4", night: "#221c17" };

/** The library takes the reader's theme, so going from one to the other doesn't change the page. */
function useTheme(): ReaderTheme {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("storage", fn);
      return () => window.removeEventListener("storage", fn);
    },
    () => loadPrefs().theme,
    () => "paper",
  );
}

const noop = () => () => {};

const loadRoom = () => import("@/components/room/room-view").then((m) => m.RoomView);
const RoomView = dynamic(loadRoom, { ssr: false, loading: () => <RoomLoader /> });

export function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { view, setView, canRoom } = useLibraryView();
  // The last list seen on this device, shown while sign-in is confirmed.
  const cached = useSyncExternalStore(noop, readCachedBooks, () => null);
  const roomFirst = view === "room" && canRoom;
  useEffect(() => {
    if (roomFirst) void loadRoom();
  }, [roomFirst]);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) clearCachedBooks();
  }, [isLoading, isAuthenticated]);
  if (isAuthenticated) return <Library cached={cached} live view={view} setView={setView} canRoom={canRoom} />;
  if (isLoading) {
    if (cached) return <Library cached={cached} live={false} view={view} setView={setView} canRoom={canRoom} />;
    return roomFirst ? <RoomLoader /> : null;
  }
  return <SignIn />;
}

function Library({
  cached,
  live,
  view,
  setView,
  canRoom,
}: {
  cached: ListedBook[] | null;
  live: boolean;
  view: LibraryView;
  setView: (v: LibraryView) => void;
  canRoom: boolean;
}) {
  const convex = useConvex();
  const fresh = useQuery(api.books.list, live ? {} : "skip");
  const books = fresh ?? cached ?? undefined;
  useDescriptionBackfill(fresh);
  const removeBook = useMutation(api.books.remove);
  const { signOut } = useAuthActions();
  const theme = useTheme();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioFor, setAudioFor] = useState<Id<"books"> | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // Set when the room can't draw here after all (no WebGL, or the GPU dropped it): the list takes over.
  const [fallback, setFallback] = useState<"webgl" | "lost" | null>(null);
  const room = view === "room" && canRoom && !fallback;
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fresh) saveCachedBooks(fresh);
  }, [fresh]);

  // The most recent book is the likeliest next open: have its file and the reader ready.
  const first = books?.[0];
  useEffect(() => {
    if (!first) return;
    const run = () => warmBook(first.epub, first.epubUrl);
    if (typeof requestIdleCallback === "function") {
      const h = requestIdleCallback(run, { timeout: 3000 });
      return () => cancelIdleCallback(h);
    }
    const t = setTimeout(run, 1000);
    return () => clearTimeout(t);
  }, [first]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = room ? SCENE : THEME_COLOR[theme];
    document.head.prepend(meta);
    document.documentElement.dataset.lib = room ? "room" : "list";
    return () => meta.remove();
  }, [theme, room]);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const epubs = Array.from(files).filter((f) => /\.epub$/i.test(f.name) || f.type === "application/epub+zip");
      if (!epubs.length) return setError("Only EPUB files can be added.");
      setError(null);
      setBusy(true);
      try {
        for (const f of epubs) await addEpub(convex, f);
      } catch (e) {
        console.error(e);
        setError("Couldn't read that file. It may not be a valid EPUB.");
      } finally {
        setBusy(false);
      }
    },
    [convex],
  );

  const attachAudio = useCallback(
    async (bookId: Id<"books">, files: File[]) => {
      const audio = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|m4b|aac|wav|ogg|opus|flac)$/i.test(f.name));
      if (!audio.length) return setError("Choose the audiobook's audio files (MP3, M4B or M4A).");
      setError(null);
      setUploads((u) => ({ ...u, [bookId]: 0 }));
      try {
        await addAudiobook(convex, bookId, audio, (done, total) => setUploads((u) => ({ ...u, [bookId]: done / total })));
      } catch (e) {
        console.error(e);
        setError("Couldn't upload that audio.");
      } finally {
        setUploads((u) => {
          const rest = { ...u };
          delete rest[bookId];
          return rest;
        });
      }
    },
    [convex],
  );

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void add(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [add]);

  const empty = books !== undefined && books.length === 0;
  const addBooks = () => inputRef.current?.click();
  const addAudio = (bookId: string) => {
    setAudioFor(bookId as Id<"books">);
    audioRef.current?.click();
  };
  const remove = async (bookId: string) => {
    setOpenId(null);
    try {
      await removeBook({ bookId: bookId as Id<"books"> });
    } catch (e) {
      console.error(e);
      setError("Couldn't remove that book.");
    }
  };
  const chooseView = (v: LibraryView) => {
    setFallback(null);
    setView(v);
  };

  const files = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={audioRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.m4b"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="audio-input"
        onChange={(e) => {
          if (e.target.files && audioFor) void attachAudio(audioFor, Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/90">
          <p className="text-lg">Drop EPUB files to add them</p>
        </div>
      )}
    </>
  );

  if (room) {
    return (
      <div className="loam-lib relative z-10 flex min-h-dvh w-full flex-1 flex-col">
        {files}
        <RoomView
          books={books}
          uploads={uploads}
          busy={busy}
          error={error}
          addBooks={live ? addBooks : () => {}}
          addAudio={live ? addAudio : () => {}}
          remove={remove}
          signOut={() => void signOut()}
          view={view}
          setView={chooseView}
          canRoom={canRoom}
          onFallback={setFallback}
          live={live}
        />
      </div>
    );
  }

  return (
    <div data-reader-theme={theme} className="relative z-10 flex min-h-dvh w-full flex-1 flex-col bg-background text-foreground animate-in duration-300 fade-in">
      {files}
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-2 pl-[max(1.25rem,env(safe-area-inset-left))] sm:pt-8">
        <h1 className="text-lg font-semibold">Loam</h1>
        <div className="flex items-center gap-1">
          {!empty && (
            <Btn icon={<Plus aria-hidden />} onClick={addBooks} disabled={busy || !live}>
              {busy ? "Adding…" : "Add book"}
            </Btn>
          )}
          {canRoom && (
            <Segmented
              label="Library view"
              options={[
                ["room", "Room"],
                ["list", "List"],
              ]}
              value="list"
              onChange={chooseView}
              className="w-32"
            />
          )}
          <IconBtn label="Sign out" onClick={() => void signOut()}>
            <LogOut aria-hidden />
          </IconBtn>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 pt-4 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] sm:pt-6">
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {fallback && (
          <p className="mb-4 text-sm text-muted-foreground">
            {fallback === "webgl" ? "This browser can't draw the 3D room, so the list is shown." : "The 3D room stopped drawing, so the list is shown."}
          </p>
        )}
        {live && !empty && <ReviewDesk />}

        {empty && (
          <button
            type="button"
            onClick={addBooks}
            disabled={busy}
            className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input px-6 py-16 text-center transition-colors duration-150 hover:bg-muted"
          >
            <span className="text-base font-medium">{busy ? "Adding…" : "Add your first book"}</span>
            <span className="text-sm text-muted-foreground">
              <span className="pointer-coarse:hidden">Drop an EPUB file here, or choose one.</span>
              <span className="hidden pointer-coarse:inline">Choose an EPUB file.</span>
            </span>
          </button>
        )}

        {books && books.length > 0 && (
          <ul className="divide-y divide-border border-y border-border">
            {books.map((b) => (
              <BookRow
                key={b._id}
                book={b}
                uploading={uploads[b._id] ?? null}
                open={openId === b._id}
                live={live}
                onToggle={() => setOpenId((cur) => (cur === b._id ? null : b._id))}
                onAddAudio={() => addAudio(b._id)}
                onRemove={() => remove(b._id)}
              />
            ))}
          </ul>
        )}
      </main>

    </div>
  );
}

function BookRow({
  book,
  uploading,
  open,
  live,
  onToggle,
  onAddAudio,
  onRemove,
}: {
  book: ListedBook;
  uploading: number | null;
  open: boolean;
  live: boolean;
  onToggle: () => void;
  onAddAudio: () => void;
  onRemove: () => Promise<void>;
}) {
  const audio = audioState(book, uploading);
  const status = [progressLabel(book), audioLabel(audio), termsLabel(book)].filter(Boolean).join(" · ");
  const percent = book.progress?.percent ?? null;
  const title = book.title || "Untitled";
  const warm = () => warmBook(book.epub, book.epubUrl);
  const hand = () => book.epubUrl && handOff(book._id, { epub: book.epub, epubUrl: book.epubUrl, cfi: book.progress?.cfi ?? "" });
  const detailsId = `book-${book._id}`;

  return (
    <li onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>
      <div className="flex items-start gap-4 py-4">
        <Link href={readHref(book._id)} onClick={hand} tabIndex={-1} aria-hidden className="shrink-0">
          <Cover url={book.coverUrl} title={title} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={readHref(book._id)} onClick={hand} className="line-clamp-2 text-base leading-snug font-medium hover:underline hover:underline-offset-4">
            {title}
          </Link>
          {book.author && <p className="mt-0.5 truncate text-sm text-muted-foreground">{book.author}</p>}
          <p className="mt-1.5 text-xs text-muted-foreground">{status}</p>
          {percent !== null && percent > 0 && (
            <div aria-hidden className="mt-2 h-0.5 max-w-48 rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground/50" style={{ width: `${Math.min(100, Math.round(percent * 100))}%` }} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {audio.kind === "ready" && (
            <Link
              href={readHref(book._id, true)}
              onClick={hand}
              aria-label={`Listen to ${title}`}
              title="Listen"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground pointer-coarse:size-11 [&_svg]:size-[18px]"
            >
              <Headphones aria-hidden />
            </Link>
          )}
          <IconBtn label={open ? "Hide details" : "Details"} aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
            <ChevronDown aria-hidden className={cn("transition-transform duration-150", open && "rotate-180")} />
          </IconBtn>
        </div>
      </div>
      {open && (
        <div id={detailsId} className="pb-5 sm:pl-[4.5rem]">
          <BookDetails book={book} audio={audio} live={live} onAddAudio={onAddAudio} onRemove={onRemove} />
        </div>
      )}
    </li>
  );
}

function Cover({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-[84px] w-14 items-center justify-center rounded-sm bg-muted font-book text-xl text-muted-foreground">
        {title.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={56}
      height={84}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-[84px] w-14 rounded-sm bg-muted object-cover"
    />
  );
}
