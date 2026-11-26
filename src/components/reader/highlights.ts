import type { Contents } from "epubjs";
import type { Anchor } from "@/lib/anchors";
import { paragraphElements, paragraphText, tokenize, wordSpans } from "@/lib/book-text";

/** Highlight API objects of the book frame's own window (each iframe has its own registry). */
type FrameWindow = Window & {
  CSS: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
};

export function paint(contents: Contents, name: string, ranges: Range[]) {
  const win = contents.window as FrameWindow;
  if (!win.CSS?.highlights || !win.Highlight) return;
  if (ranges.length) win.CSS.highlights.set(name, new win.Highlight(...ranges));
  else win.CSS.highlights.delete(name);
}

const paraCache = new WeakMap<Document, Element[]>();

/** Paragraph elements of a rendered section, split by the same rules as the stored text. */
export function paragraphsOf(contents: Contents): Element[] {
  const doc = contents.document;
  let paras = paraCache.get(doc);
  if (!paras) {
    paras = paragraphElements(doc);
    paraCache.set(doc, paras);
  }
  return paras;
}

/** The DOM position under a point in the book frame (frame-relative coordinates). */
export function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** Whether a range is on the visible page, measured in screen coordinates. */
export function isVisible(contents: Contents, range: Range, viewport: HTMLElement): boolean {
  const frame = contents.window.frameElement as HTMLElement | null;
  const rect = range.getClientRects()[0];
  if (!frame || !rect) return false;
  const f = frame.getBoundingClientRect();
  const v = viewport.getBoundingClientRect();
  const x = f.left + rect.left + rect.width / 2;
  const y = f.top + rect.top + rect.height / 2;
  return x >= v.left && x <= v.right && y >= v.top && y <= v.bottom;
}

/** The book frame's rectangle on screen, to turn frame-relative coordinates into screen ones. */
export const frameRect = (contents: Contents) => (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect() ?? null;

type Point = { node: Node; offset: number };

/** Where a point lies relative to an element: -1 before it, 0 inside it, 1 after it. */
function placeOf(el: Element, p: Point): number {
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(el);
  try {
    return r.comparePoint(p.node, p.offset);
  } catch {
    return -1;
  }
}

/** Whether point `a` comes strictly before point `b`. */
function precedes(a: Point, b: Point) {
  const r = (a.node.ownerDocument ?? (a.node as Document)).createRange();
  r.setStart(a.node, a.offset);
  return r.comparePoint(b.node, b.offset) > 0;
}

/** Index of the first paragraph that holds a point or comes after it (-1 if the point is past them all). */
export function paragraphAt(contents: Contents, p: Point) {
  return paragraphsOf(contents).findIndex((el) => placeOf(el, p) <= 0);
}

/**
 * The whole words a DOM range covers, as an anchor in the section's stored text. Words cut by the
 * range count in full; whitespace or markup around the paragraphs is ignored. Null if it covers no word.
 */
export function rangeAnchor(contents: Contents, range: Range): Anchor | null {
  const paras = paragraphsOf(contents);
  const start = { node: range.startContainer, offset: range.startOffset };
  const end = { node: range.endContainer, offset: range.endOffset };
  let sp = paras.findIndex((el) => placeOf(el, start) <= 0);
  let ep = paras.findLastIndex((el) => placeOf(el, end) >= 0);
  if (sp < 0 || ep < 0 || sp > ep) return null;

  // First word that ends after the start; if the range starts after a paragraph's last word, move on.
  let sw = -1;
  for (; sp <= ep; sp++, sw = -1) {
    sw = wordSpans(paras[sp]).findIndex((w) => precedes(start, { node: w.endNode, offset: w.endOffset }));
    if (sw >= 0) break;
  }
  // Last word that starts before the end; if the range ends before a paragraph's first word, step back.
  let ew = -1;
  for (; ep >= sp; ep--) {
    ew = wordSpans(paras[ep]).findLastIndex((w) => precedes({ node: w.startNode, offset: w.startOffset }, end));
    if (ew >= 0) break;
  }
  if (sw < 0 || ew < 0 || sp > ep || (sp === ep && sw > ew)) return null;
  return { section: contents.sectionIndex, startPara: sp, startWord: sw, endPara: ep, endWord: ew };
}

/** The DOM range of an anchor's words in a rendered section, punctuation included. */
export function anchorRange(contents: Contents, a: Anchor): Range | null {
  const paras = paragraphsOf(contents);
  const from = paras[a.startPara] && wordSpans(paras[a.startPara])[a.startWord];
  const to = paras[a.endPara] && wordSpans(paras[a.endPara])[a.endWord];
  if (!from || !to) return null;
  const r = contents.document.createRange();
  r.setStart(from.startNode, from.startOffset);
  r.setEnd(to.endNode, to.endOffset);
  return r;
}

/** An anchor's words as they read in the stored text (same as the backend's quote). */
export function anchorWords(contents: Contents, a: Anchor): string[] {
  const paras = paragraphsOf(contents);
  const out: string[] = [];
  for (let p = a.startPara; p <= a.endPara; p++) {
    const words = tokenize(paragraphText(paras[p]));
    out.push(...words.slice(p === a.startPara ? a.startWord : 0, p === a.endPara ? a.endWord + 1 : undefined));
  }
  return out;
}

/** Whether a frame-relative point lies inside a range (the hit test for tapping painted text). */
export function rangeHit(contents: Contents, x: number, y: number) {
  const pos = caretAt(contents.document, x, y);
  return (range: Range) => {
    if (!pos) return false;
    try {
      return range.isPointInRange(pos.node, pos.offset);
    } catch {
      return false;
    }
  };
}
