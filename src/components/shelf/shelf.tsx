"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SignIn } from "@/components/auth/sign-in";
import { FlatView } from "@/components/room/flat-view";
import type { LibraryProps } from "@/components/room/library";
import { useLibraryView } from "@/components/room/view-mode";
import { useDescriptionBackfill } from "@/lib/describe";
import { addAudiobook, addEpub } from "@/lib/upload";
import { cn } from "@/lib/utils";
import "@/components/room/room.css";

/** The 3D room: three.js and the scene load only in the browser, and only when the room is shown. */
const RoomView = dynamic(() => import("@/components/room/room-view").then((m) => m.RoomView), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-[var(--lib-scene)]">
      <p className="sc-wide text-sm text-[rgba(239,228,207,0.8)]">Lighting the lamp</p>
    </div>
  ),
});

export function Shelf() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return null;
  return isAuthenticated ? <Library /> : <SignIn />;
}

function Library() {
  const convex = useConvex();
  const books = useQuery(api.books.list);
  useDescriptionBackfill(books);
  const removeBook = useMutation(api.books.remove);
  const { signOut } = useAuthActions();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const { view, setView, canRoom } = useLibraryView();
  // Set when the room can't run here after all (no WebGL, or the GPU dropped it): the list takes over.
  const [fallback, setFallback] = useState<"webgl" | "lost" | null>(null);

  const lib: LibraryProps = {
    books,
    uploads,
    busy,
    error,
    addBooks: () => inputRef.current?.click(),
    addAudio: (bookId) => {
      setAudioFor(bookId as Id<"books">);
      audioRef.current?.click();
    },
    remove: async (bookId) => {
      try {
        await removeBook({ bookId: bookId as Id<"books"> });
      } catch (e) {
        console.error(e);
        setError("Couldn't remove that book.");
      }
    },
    signOut: () => void signOut(),
    view,
    setView: (v) => {
      setFallback(null);
      setView(v);
    },
    canRoom: canRoom && !fallback,
  };
  const room = view === "room" && canRoom && !fallback;

  return (
    <div className="loam-lib relative z-10 flex min-h-dvh w-full flex-1 flex-col">
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

      {room ? (
        <RoomView {...lib} onFallback={setFallback} />
      ) : (
        <FlatView
          {...lib}
          notice={fallback === "webgl" ? "This browser can't draw the 3D room, so here is the list." : fallback === "lost" ? "The 3D room stopped drawing, so here is the list." : null}
        />
      )}

      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,16,12,0.82)] backdrop-blur-sm transition-opacity duration-200",
          dragging ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="text-2xl">Place it on the shelf</p>
      </div>
    </div>
  );
}
