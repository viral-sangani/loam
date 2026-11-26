"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Contents } from "epubjs";
import type { Anchor } from "@/lib/anchors";
import { anchorRange, anchorWords, frameRect, paint, rangeAnchor } from "./highlights";

/** A rectangle in screen (window) coordinates. */
export type Box = { top: number; bottom: number; left: number; right: number };

/** Text selected in the book, snapped to whole words. */
export type Picked = { anchor: Anchor; quote: string; words: number; box: Box; contents: Contents };

/** After the last selection change, how long to wait before showing the lens (touch handles keep adjusting it). */
const SETTLE_MS = 250;

/** The on-screen box around the part of a range that's on the visible page (paginated columns run off-screen). */
function visibleBox(contents: Contents, range: Range, viewport: HTMLElement | null): Box | null {
  const f = frameRect(contents);
  const v = viewport?.getBoundingClientRect();
  if (!f || !v) return null;
  let box: Box | null = null;
  for (const r of range.getClientRects()) {
    const b = { top: f.top + r.top, bottom: f.top + r.bottom, left: f.left + r.left, right: f.left + r.right };
    if (r.width === 0 || b.right < v.left || b.left > v.right || b.bottom < v.top || b.top > v.bottom) continue;
    box = box
      ? { top: Math.min(box.top, b.top), bottom: Math.max(box.bottom, b.bottom), left: Math.min(box.left, b.left), right: Math.max(box.right, b.right) }
      : b;
  }
  return box;
}

function pick(contents: Contents, range: Range, viewport: HTMLElement | null): Picked | null {
  if (!/\S/.test(range.toString())) return null;
  const anchor = rangeAnchor(contents, range);
  const box = anchor && visibleBox(contents, range, viewport);
  if (!anchor || !box) return null;
  const words = anchorWords(contents, anchor);
  return { anchor, quote: words.join(" "), words: words.length, box, contents };
}

/**
 * Follows the reader's text selection in the book frame. The lens shows once a selection settles
 * (on mouse release, or after touch handles stop moving). `freeze` keeps the current pick while a
 * note or question is typed, painting it so it stays visible; `clear` drops it and the selection.
 */
export function useSelection(contents: Contents | null, viewport: RefObject<HTMLElement | null>) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const frozen = useRef<Picked | null>(null);

  const clear = useCallback(() => {
    const held = frozen.current;
    if (held) paint(held.contents, "loam-picked", []);
    frozen.current = null;
    setPicked(null);
    contents?.window.getSelection()?.removeAllRanges();
  }, [contents]);

  const freeze = useCallback(() => {
    if (!picked || frozen.current) return;
    frozen.current = picked;
    const range = anchorRange(picked.contents, picked.anchor);
    if (range) paint(picked.contents, "loam-picked", [range]);
    // The painted copy stands in for the selection, so the two don't tint the words twice.
    picked.contents.window.getSelection()?.removeAllRanges();
  }, [picked]);

  useEffect(() => {
    if (!contents) return;
    const doc = contents.document;
    const win = contents.window;
    let dragging = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      if (frozen.current) return;
      const sel = win.getSelection();
      const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      setPicked(range ? pick(contents, range, viewport.current) : null);
    };
    const settle = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(read, ms);
    };
    const onChange = () => {
      if (frozen.current) return;
      // Hide while a mouse drag is still extending the selection; show it on release.
      if (dragging) setPicked(null);
      else settle(SETTLE_MS);
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (frozen.current) return clear(); // pressing the page while typing a note or question dismisses it
      if (e.type === "mousedown" && (e as MouseEvent).button === 0) dragging = true;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      settle(0);
    };
    doc.addEventListener("selectionchange", onChange);
    doc.addEventListener("mousedown", onDown);
    doc.addEventListener("touchstart", onDown, { passive: true });
    doc.addEventListener("mouseup", onUp);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("selectionchange", onChange);
      doc.removeEventListener("mousedown", onDown);
      doc.removeEventListener("touchstart", onDown);
      doc.removeEventListener("mouseup", onUp);
    };
  }, [contents, viewport, clear]);

  // Pressing anywhere outside the book frame and the lens dismisses it; so does a re-layout, which
  // would leave it floating over the wrong words (but not while typing: a phone keyboard may resize).
  const active = picked !== null;
  useEffect(() => {
    if (!active) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest("[data-lens]"))) clear();
    };
    const resized = () => !frozen.current && clear();
    window.addEventListener("pointerdown", away);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", resized);
    };
  }, [active, clear]);

  return { picked: picked && picked.contents === contents ? picked : null, freeze, clear };
}

export type SelectionState = ReturnType<typeof useSelection>;
