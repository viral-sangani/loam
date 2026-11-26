import type { Contents } from "epubjs";
import { paragraphElements } from "@/lib/book-text";

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
