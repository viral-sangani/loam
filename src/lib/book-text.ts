/**
 * How Loam splits a book into paragraphs and words.
 *
 * The same rules run when a book is uploaded (to store its text), in the reader (to find the word
 * the audio is on and the terms to underline) and in the aligner (to time each word), so a
 * (section, paragraph, word) position means the same thing everywhere. Keep them in sync with
 * `worker/align.mjs`.
 */

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,dt,dd,figcaption,pre,td,th,div";

/** Leaf block elements (blocks with no block inside) that contain text, in document order. */
export function paragraphElements(doc: Document): Element[] {
  const root = doc.body ?? doc.documentElement;
  return Array.from(root.querySelectorAll(BLOCKS)).filter((el) => !el.querySelector(BLOCKS) && /\S/.test(el.textContent ?? ""));
}

export const paragraphText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** Words are runs of non-space characters. */
export const tokenize = (text: string) => text.match(/\S+/g) ?? [];

/** Lowercase letters and digits only, for comparing words. */
export const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A word's place in the paragraph's text nodes. */
type Span = { startNode: Text; startOffset: number; endNode: Text; endOffset: number };

const spanCache = new WeakMap<Element, Span[]>();

/** The DOM position of every word in a paragraph element (cached per element). */
export function wordSpans(el: Element): Span[] {
  const cached = spanCache.get(el);
  if (cached) return cached;
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  const locate = (pos: number, end: boolean) => {
    // The text node holding character `pos` (for an end position, the node holding pos - 1).
    let i = nodes.length - 1;
    while (i > 0 && (end ? nodes[i].start >= pos : nodes[i].start > pos)) i--;
    return { node: nodes[i].node, offset: pos - nodes[i].start };
  };
  const spans: Span[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const s = locate(m.index!, false);
    const e = locate(m.index! + m[0].length, true);
    spans.push({ startNode: s.node, startOffset: s.offset, endNode: e.node, endOffset: e.offset });
  }
  spanCache.set(el, spans);
  return spans;
}

export function wordRange(el: Element, from: number, to = from): Range | null {
  const spans = wordSpans(el);
  const a = spans[from];
  const b = spans[to];
  if (!a || !b) return null;
  // Leave quotes and punctuation at the edges out of the highlight ("Alexandria," → "Alexandria").
  let so = a.startOffset;
  let eo = b.endOffset;
  const lead = /^[^\p{L}\p{N}]+/u.exec(a.startNode.data.slice(so, a.startNode === b.endNode ? eo : undefined));
  if (lead && lead[0].length < (a.startNode === b.endNode ? eo - so : Infinity)) so += lead[0].length;
  const trail = /[^\p{L}\p{N}]+$/u.exec(b.endNode.data.slice(b.endNode === a.startNode ? so : 0, eo));
  if (trail && (b.endNode !== a.startNode || trail[0].length < eo - so)) eo -= trail[0].length;
  const r = el.ownerDocument.createRange();
  r.setStart(a.startNode, so);
  r.setEnd(b.endNode, eo);
  return r;
}

/** Where a term's words occur in a paragraph's words, matching on normalized words. */
export function findTerm(paraWords: string[], term: string): [number, number] | null {
  const t = tokenize(term).map(norm).filter(Boolean);
  if (!t.length) return null;
  const words = paraWords.map(norm);
  outer: for (let i = 0; i + t.length <= words.length; i++) {
    for (let j = 0; j < t.length; j++) {
      // The term's last word may be followed by punctuation or a possessive in the text ("Rome's").
      const w = words[i + j];
      if (w !== t[j] && !(j === t.length - 1 && w.startsWith(t[j]) && w.length - t[j].length <= 1)) continue outer;
    }
    return [i, i + t.length - 1];
  }
  return null;
}
