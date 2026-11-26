"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticUpdate } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Contents } from "epubjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Anchor } from "@/lib/anchors";
import { anchorRange, paint, rangeHit } from "./highlights";

export const MARK_COLORS = ["yellow", "green", "rose", "blue"] as const;
export type MarkColor = (typeof MARK_COLORS)[number];

/** Opaque swatches for the colour pickers (the page itself gets translucent washes; see use-epub-reader). */
export const SWATCH: Record<MarkColor, string> = {
  yellow: "oklch(0.86 0.13 90)",
  green: "oklch(0.76 0.1 135)",
  rose: "oklch(0.74 0.11 15)",
  blue: "oklch(0.74 0.08 245)",
};

export const markColor = (c: string | null | undefined): MarkColor =>
  MARK_COLORS.includes(c as MarkColor) ? (c as MarkColor) : "yellow";

export type Mark = FunctionReturnType<typeof api.marks.list>[number];

// Optimistic updates, so a highlight appears, changes or goes the moment it's touched.
const addMark: OptimisticUpdate<FunctionArgs<typeof api.marks.create>> = (store, args) => {
  const key = { bookId: args.bookId, section: args.anchor.section };
  const cur = store.getQuery(api.marks.list, key);
  if (cur === undefined) return;
  const temp = { _id: crypto.randomUUID() as Id<"marks">, anchor: args.anchor, quote: "", color: args.color ?? null, note: args.note ?? null, createdAt: Date.now() };
  store.setQuery(api.marks.list, key, [...cur, temp]);
};
const patchMark: OptimisticUpdate<FunctionArgs<typeof api.marks.update>> = (store, { markId, note, color }) => {
  const patch = { ...(note !== undefined ? { note: note.trim() || null } : {}), ...(color !== undefined ? { color } : {}) };
  for (const { args, value } of store.getAllQueries(api.marks.list)) {
    if (value) store.setQuery(api.marks.list, args, value.map((m) => (m._id === markId ? { ...m, ...patch } : m)));
  }
};
const dropMark: OptimisticUpdate<FunctionArgs<typeof api.marks.remove>> = (store, { markId }) => {
  for (const { args, value } of store.getAllQueries(api.marks.list)) {
    if (value) store.setQuery(api.marks.list, args, value.filter((m) => m._id !== markId));
  }
};

/**
 * The reader's highlights in the section on screen: painted with the Highlight API (one highlight
 * per colour, plus an underline for those with a note) and hit-tested on press.
 */
export function useMarks(bookId: Id<"books">, contents: Contents | null, onOpen: (markId: Id<"marks">) => void) {
  const section = contents?.sectionIndex;
  const marks = useQuery(api.marks.list, section === undefined ? "skip" : { bookId, section });
  const placed = useRef<{ id: Id<"marks">; range: Range }[]>([]);

  useEffect(() => {
    if (!contents || !marks) return;
    const byColor = new Map<MarkColor, Range[]>(MARK_COLORS.map((c) => [c, []]));
    const noted: Range[] = [];
    const out: typeof placed.current = [];
    for (const m of marks) {
      const range = m.anchor.section === contents.sectionIndex ? anchorRange(contents, m.anchor) : null;
      if (!range) continue;
      byColor.get(markColor(m.color))!.push(range);
      if (m.note) noted.push(range);
      out.push({ id: m._id, range });
    }
    placed.current = out;
    for (const [c, ranges] of byColor) paint(contents, `loam-mark-${c}`, ranges);
    paint(contents, "loam-mark-note", noted);
  }, [contents, marks]);

  /** Opens the highlight under a press (the shortest one, where they overlap). */
  const press = useCallback(
    (c: Contents, x: number, y: number) => {
      const hit = rangeHit(c, x, y);
      const hits = placed.current.filter((p) => hit(p.range));
      if (!hits.length) return false;
      const len = (r: Range) => r.toString().length;
      onOpen(hits.reduce((a, b) => (len(b.range) < len(a.range) ? b : a)).id);
      return true;
    },
    [onOpen],
  );

  const createBase = useMutation(api.marks.create);
  const updateBase = useMutation(api.marks.update);
  const removeBase = useMutation(api.marks.remove);
  const createMutation = useMemo(() => createBase.withOptimisticUpdate(addMark), [createBase]);
  const updateMutation = useMemo(() => updateBase.withOptimisticUpdate(patchMark), [updateBase]);
  const removeMutation = useMemo(() => removeBase.withOptimisticUpdate(dropMark), [removeBase]);

  const create = useCallback(
    (anchor: Anchor, color: MarkColor, note?: string) => createMutation({ bookId, anchor, color, note }).catch(() => null),
    [createMutation, bookId],
  );
  const update = useCallback(
    (markId: Id<"marks">, patch: { note?: string; color?: MarkColor }) => updateMutation({ markId, ...patch }).catch(() => {}),
    [updateMutation],
  );
  const remove = useCallback((markId: Id<"marks">) => removeMutation({ markId }).catch(() => {}), [removeMutation]);

  return { marks, press, create, update, remove };
}

export type Marks = ReturnType<typeof useMarks>;
