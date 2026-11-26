"use client";

import type { ConvexReactClient } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { paragraphElements, paragraphText, tokenize } from "./book-text";
import { cacheBookFile } from "./library";

type Section = { index: number; paragraphs: string[] };

/** Read title, author, cover and the text of every section, split the way the reader splits it. */
async function readEpub(file: File) {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await file.arrayBuffer());
  try {
    const metadata = await book.loaded.metadata;
    await book.ready;
    let cover: Blob | null = null;
    try {
      const url = await book.coverUrl();
      if (url) cover = await (await fetch(url)).blob();
    } catch {
      /* no cover */
    }
    const sections: Section[] = [];
    const items: { index: number; load: (r: unknown) => Promise<unknown>; document?: Document; unload: () => void }[] = [];
    book.spine.each((s: (typeof items)[number]) => items.push(s));
    for (const s of items) {
      await s.load(book.load.bind(book));
      const paragraphs = s.document ? paragraphElements(s.document).map(paragraphText) : [];
      s.unload();
      if (paragraphs.length) sections.push({ index: s.index, paragraphs });
    }
    return { title: metadata.title?.trim() ?? "", author: metadata.creator?.trim() ?? "", cover, sections };
  } finally {
    book.destroy();
  }
}

async function uploadFile(convex: ConvexReactClient, file: Blob): Promise<Id<"_storage">> {
  const url = await convex.mutation(api.books.generateUploadUrl, {});
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/** Adds an EPUB to the signed-in user's shelf. */
export async function addEpub(convex: ConvexReactClient, file: File) {
  const meta = await readEpub(file);
  const [epub, cover] = await Promise.all([uploadFile(convex, file), meta.cover ? uploadFile(convex, meta.cover) : undefined]);
  void cacheBookFile(epub, file);
  const wordCount = meta.sections.reduce((n, s) => n + s.paragraphs.reduce((m, p) => m + tokenize(p).length, 0), 0);
  const bookId = await convex.mutation(api.books.create, {
    title: meta.title || file.name.replace(/\.epub$/i, ""),
    author: meta.author,
    epub,
    cover,
    wordCount,
  });
  // Send the text in batches that stay well under Convex's argument size limit.
  let batch: Section[] = [];
  let size = 0;
  const flush = async () => {
    if (batch.length) await convex.mutation(api.books.addSections, { bookId, sections: batch });
    batch = [];
    size = 0;
  };
  for (const s of meta.sections) {
    const bytes = s.paragraphs.reduce((n, p) => n + p.length, 0);
    if (size + bytes > 400_000) await flush();
    batch.push(s);
    size += bytes;
  }
  await flush();
  await convex.mutation(api.books.finishUpload, { bookId });
  return bookId;
}

/** Uploads audiobook files (sorted by name, the usual track order) and queues the word timing. */
export async function addAudiobook(
  convex: ConvexReactClient,
  bookId: Id<"books">,
  files: File[],
  onProgress: (done: number, total: number) => void,
) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = sorted.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const uploaded = [];
  for (const f of sorted) {
    const storageId = await uploadFile(convex, f);
    done += f.size;
    onProgress(done, total);
    uploaded.push({ storageId, name: f.name, size: f.size });
  }
  await convex.mutation(api.books.attachAudio, { bookId, files: uploaded });
}
