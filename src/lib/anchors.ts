/**
 * Places in a book, shared by the reader, the notebook, the reading map and the backend.
 * A section is a spine index; paragraphs and words are split by `src/lib/book-text.ts`.
 */

/** A paragraph: where the reader is, or what an answer cites. */
export type Pos = { section: number; para: number };

/** A stretch of text by word, inclusive, within one section. */
export type Anchor = { section: number; startPara: number; startWord: number; endPara: number; endWord: number };

export const comparePos = (a: Pos, b: Pos) => a.section - b.section || a.para - b.para;

export const anchorStart = (a: Anchor): Pos => ({ section: a.section, para: a.startPara });

/** Paragraph citations in AI answers: [¶12.4] or a range [¶12.4-6]. */
export const CITATION = /\[¶(\d+)\.(\d+)(?:[-–](\d+))?\]/g;
