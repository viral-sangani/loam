"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAuthActions } from "@convex-dev/auth/react";
import { Headphones, LogOut, Plus, Sprout, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SignIn } from "@/components/auth/sign-in";
import { Button } from "@/components/ui/button";
import { addAudiobook, addEpub } from "@/lib/upload";
import { cn } from "@/lib/utils";

type Book = FunctionReturnType<typeof api.books.list>[number];

function Cover({ book, className }: { book: Book; className?: string }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-[3px] bg-secondary shadow-[0_1px_2px_oklch(0.3_0.04_55/0.25),0_6px_14px_-8px_oklch(0.3_0.04_55/0.4)]", className)}>
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={book.coverUrl} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center p-1 text-center font-serif text-[9px] leading-tight text-muted-foreground">
          {book.title}
        </div>
      )}
    </div>
  );
}

/** One quiet line about the background work on a book. */
function Status({ book, uploading }: { book: Book; uploading: number | null }) {
  const parts: string[] = [];
  if (uploading !== null) parts.push(`Uploading audio ${Math.round(uploading * 100)}%`);
  else if (book.audio) {
    const a = book.audio;
    if (a.status === "ready") parts.push("Audio synced");
    else if (a.status === "error") parts.push("Audio sync failed");
    else if (a.status === "queued") parts.push("Audio waiting to sync");
    else parts.push(`Syncing audio ${Math.round(a.progress * 100)}%`);
  }
  const t = book.terms;
  if (t.status === "running" && t.total) parts.push(`Finding words ${Math.round((t.done / t.total) * 100)}%`);
  if (!parts.length) return null;
  return <p className="mt-1 truncate text-[11px] text-muted-foreground">{parts.join(" · ")}</p>;
}

export function Shelf() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return null;
  return isAuthenticated ? <Library /> : <SignIn />;
}

function Library() {
  const convex = useConvex();
  const books = useQuery(api.books.list);
  const removeBook = useMutation(api.books.remove);
  const { signOut } = useAuthActions();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [audioFor, setAudioFor] = useState<Id<"books"> | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const epubs = Array.from(files).filter((f) => /\.epub$/i.test(f.name) || f.type === "application/epub+zip");
      if (!epubs.length) return setError("Loam reads EPUB files for now.");
      setError(null);
      setBusy(true);
      try {
        for (const f of epubs) await addEpub(convex, f);
      } catch (e) {
        console.error(e);
        setError("Couldn't read that file. Is it a valid EPUB?");
      } finally {
        setBusy(false);
      }
    },
    [convex],
  );

  const attachAudio = useCallback(
    async (bookId: Id<"books">, files: File[]) => {
      const audio = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|m4b|aac|wav|ogg|opus|flac)$/i.test(f.name));
      if (!audio.length) return setError("Choose the audiobook's audio files (MP3, M4B, M4A…).");
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

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-16">
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        className="sr-only"
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
        data-testid="audio-input"
        onChange={(e) => {
          if (e.target.files && audioFor) void attachAudio(audioFor, Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity",
          dragging ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="font-serif text-2xl">Place it on the shelf</p>
      </div>

      <header className="mb-8 flex items-center justify-between sm:mb-14">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sprout className="size-4" />
          </span>
          <span className="font-serif text-2xl tracking-tight">Loam</span>
        </div>
        <div className="flex items-center gap-1">
          {!empty && books && (
            <Button variant="ghost" size="sm" className="text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Plus /> {busy ? "Shelving…" : "Add"}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out" className="text-muted-foreground pointer-coarse:size-11" onClick={() => void signOut()}>
            <LogOut />
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {empty && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-16 text-center sm:px-8 sm:py-24 transition-colors hover:border-primary/50 hover:bg-card/60"
          >
            <span className="font-serif text-2xl">{busy ? "Shelving…" : "Your shelf is empty"}</span>
            <span className="text-sm text-muted-foreground">
              <span className="pointer-coarse:hidden">Drop an EPUB here, or </span>
              <span className="text-primary underline underline-offset-4">
                <span className="pointer-coarse:hidden">choose one</span>
                <span className="hidden pointer-coarse:inline">Choose an EPUB</span>
              </span>
            </span>
          </button>
        )}

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {books && books.length > 0 && (
          <ul className="space-y-1">
            {books.map((b) => {
              const pct = b.progress?.percent;
              return (
                <li key={b._id} className="group relative">
                  <Link
                    href={`/read/${b._id}`}
                    className="flex items-center gap-4 rounded-2xl py-3 pr-24 pl-2 transition-colors hover:bg-card/70 sm:gap-5 sm:px-3 sm:pr-24"
                  >
                    <Cover book={b} className="h-[72px] w-12" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-lg leading-snug">{b.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{b.author}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-px max-w-40 flex-1 bg-border">
                          <div className="h-px bg-primary" style={{ width: `${(pct ?? 0) * 100}%` }} />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {b.progress ? (pct != null ? `${Math.round(pct * 100)}%` : "Started") : "New"}
                        </span>
                      </div>
                      <Status book={b} uploading={uploads[b._id] ?? null} />
                    </div>
                  </Link>
                  <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 sm:right-3">
                    {confirmId === b._id ? (
                      <div className="flex items-center gap-1 rounded-full bg-card px-1 py-0.5 text-xs shadow-sm">
                        <span className="px-2 text-muted-foreground">Remove?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            await removeBook({ bookId: b._id });
                            setConfirmId(null);
                          }}
                        >
                          Remove
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={b.audio ? `Replace audiobook for ${b.title}` : `Add audiobook for ${b.title}`}
                          title={b.audio ? "Replace audiobook" : "Add audiobook"}
                          disabled={b._id in uploads}
                          onClick={() => {
                            setAudioFor(b._id);
                            audioRef.current?.click();
                          }}
                          className={cn(
                            "text-muted-foreground transition-opacity pointer-coarse:size-11",
                            b.audio ? "opacity-60" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-60",
                          )}
                        >
                          <Headphones />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${b.title}`}
                          onClick={() => setConfirmId(b._id)}
                          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-60"
                        >
                          <X />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
