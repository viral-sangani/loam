/**
 * Matches the words heard in an audiobook to the words of the book, giving every book word a start time.
 *
 * The book's words come from the paragraphs stored at upload, split exactly like src/lib/book-text.ts
 * (runs of non-space characters). Speech recognition makes mistakes and the narration skips or adds
 * things (credits, front matter), so the match is done in three steps:
 *  1. anchors: 3-word sequences that occur exactly once in both, kept in a consistent order;
 *  2. the gaps between anchors are matched word by word (longest common subsequence);
 *  3. words still without a time are interpolated between their timed neighbours, where about as
 *     many words were spoken in between as the book has (otherwise that stretch wasn't narrated).
 */

export const tokenize = (text) => text.match(/\S+/g) ?? [];
export const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const K = 3;
const MAX_DP_CELLS = 4_000_000;
/** Interpolate across a gap only if it averages under this per word (else it wasn't narrated). */
const MAX_MS_PER_WORD = 1500;

/** Indices of a longest strictly increasing subsequence of `values`. */
function lis(values) {
  const tails = [];
  const prev = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = [];
  for (let i = tails[tails.length - 1] ?? -1; i !== -1; i = prev[i]) out.push(i);
  return out.reverse();
}

/** Word-by-word match of b[b0..b1) with t[t0..t1); sets time[bi] for matched words. */
function matchGap(b, t, tTimes, time, tIdx, b0, b1, t0, t1) {
  const n = b1 - b0;
  const m = t1 - t0;
  if (n <= 0 || m <= 0 || n * m > MAX_DP_CELLS) return;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = b[b0 + i] === t[t0 + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (b[b0 + i] === t[t0 + j]) {
      time[b0 + i] = tTimes[t0 + j];
      tIdx[b0 + i] = t0 + j;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
}

/**
 * @param {{index: number, paragraphs: string[]}[]} sections in reading order
 * @param {{w: string, start: number}[]} spoken words in time order (ms)
 */
export function align(sections, spoken) {
  // Book words that have letters or digits, with where they live.
  const where = []; // [sectionPos, wordIndex]
  const b = [];
  const wordsPerSection = sections.map((sec, s) => {
    let i = 0;
    for (const p of sec.paragraphs)
      for (const tok of tokenize(p)) {
        const n = norm(tok);
        if (n) {
          where.push([s, i]);
          b.push(n);
        }
        i++;
      }
    return i;
  });
  const t = [];
  const tTimes = [];
  for (const x of spoken) {
    const n = norm(x.w);
    if (n) {
      t.push(n);
      tTimes.push(x.start);
    }
  }

  // 1. Anchors: 3-grams unique on both sides.
  const grams = (arr) => {
    const m = new Map();
    for (let i = 0; i + K <= arr.length; i++) {
      const g = arr.slice(i, i + K).join(" ");
      m.set(g, m.has(g) ? -1 : i);
    }
    return m;
  };
  const gb = grams(b);
  const gt = grams(t);
  const pairs = [];
  for (const [g, bi] of gb) {
    const ti = gt.get(g);
    if (bi >= 0 && ti !== undefined && ti >= 0) pairs.push([bi, ti]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const chain = lis(pairs.map((p) => p[1])).map((i) => pairs[i]);

  const time = new Float64Array(b.length).fill(-1);
  const tIdx = new Int32Array(b.length).fill(-1);
  let lastB = 0;
  let lastT = 0;
  for (const [bi, ti] of chain) {
    if (bi < lastB || ti < lastT) continue; // overlapping anchors
    // 2. Fill the gap before this anchor word by word.
    matchGap(b, t, tTimes, time, tIdx, lastB, bi, lastT, ti);
    for (let k = 0; k < K; k++) {
      time[bi + k] = tTimes[ti + k];
      tIdx[bi + k] = ti + k;
    }
    lastB = bi + K;
    lastT = ti + K;
  }
  matchGap(b, t, tTimes, time, tIdx, lastB, b.length, lastT, t.length);

  // 3. Interpolate between timed neighbours when the pace is plausible.
  let matched = 0;
  let prevIdx = -1;
  for (let i = 0; i < b.length; i++) {
    if (time[i] < 0) continue;
    matched++;
    if (prevIdx >= 0 && i - prevIdx > 1) {
      const t0 = time[prevIdx];
      const t1 = time[i];
      const steps = i - prevIdx;
      // Only where about as many words were spoken as the book has: otherwise the gap wasn't narrated.
      const bookGap = steps - 1;
      const spokenGap = tIdx[i] - tIdx[prevIdx] - 1;
      const similar = Math.abs(bookGap - spokenGap) <= Math.max(2, 0.3 * Math.max(bookGap, spokenGap));
      if (similar && t1 > t0 && (t1 - t0) / steps <= MAX_MS_PER_WORD)
        for (let k = 1; k < steps; k++) time[prevIdx + k] = t0 + ((t1 - t0) * k) / steps;
    }
    prevIdx = i;
  }

  // Back to per-section arrays over *all* tokens (punctuation-only tokens stay -1: never highlighted).
  const starts = wordsPerSection.map((n) => new Array(n).fill(-1));
  where.forEach(([s, i], k) => (starts[s][i] = Math.round(time[k])));

  return {
    coverage: b.length ? matched / b.length : 0,
    sections: sections.map((sec, s) => {
      const arr = starts[s];
      const first = arr.find((x) => x >= 0) ?? -1;
      let last = -1;
      for (let i = arr.length - 1; i >= 0; i--)
        if (arr[i] >= 0) {
          last = arr[i];
          break;
        }
      return { section: sec.index, starts: arr, startMs: first, endMs: last >= 0 ? last + 800 : -1 };
    }),
  };
}
