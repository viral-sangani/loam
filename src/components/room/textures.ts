/* Canvas drawings for the reading room: book covers, spines, backs, the reading card, preview pages
   and the room's own surfaces. Ported from the approved prototype (loam-room.js). Everything drawn
   here is also available as DOM text in room-view.tsx for screen readers. */

import type { CoverImage } from "./covers";
import { addedLabel, duration, finished, pct, progressLabel, type PreviewPara, type ShelfBook } from "./model";

type G = CanvasRenderingContext2D;

export const FONT = '"Literata", Georgia, "Times New Roman", serif';
export const PAPER = "#efe4cf";
export const INK = "#2b2119";
export const INK2 = "#6b5a48";
export const OX = "#7a2731";
export const BRASS = "#c49a52";
const TAU = Math.PI * 2;
const HALF = Math.PI / 2;

/* ---------- helpers ---------- */
export function mk(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
const ctx = (c: HTMLCanvasElement) => c.getContext("2d")!;
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => clamp(Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt), 0, 255);
  return "#" + ((1 << 24) + (f((n >> 16) & 255) << 16) + (f((n >> 8) & 255) << 8) + f(n & 255)).toString(16).slice(1);
}
let noise: HTMLCanvasElement | null = null;
function noiseTile() {
  if (noise) return noise;
  const c = mk(128, 128);
  const g = ctx(c);
  const d = g.createImageData(128, 128);
  const r = rng(99);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (r() * 255) | 0;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  noise = c;
  return c;
}
function grain(g: G, w: number, h: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = "overlay";
  g.fillStyle = g.createPattern(noiseTile(), "repeat")!;
  g.fillRect(0, 0, w, h);
  g.restore();
}
function weave(g: G, w: number, h: number, base: string, s = 1) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  grain(g, w, h, 0.35 * s);
  g.save();
  g.lineWidth = 1;
  g.globalAlpha = 0.16 * s;
  g.strokeStyle = "#000";
  for (let y = 0; y < h; y += 3) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(w, y + 0.5);
    g.stroke();
  }
  g.globalAlpha = 0.07 * s;
  g.strokeStyle = "#fff";
  for (let x = 0; x < w; x += 3) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, h);
    g.stroke();
  }
  g.restore();
  const rg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
  rg.addColorStop(0, "rgba(255,255,255,0.05)");
  rg.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);
}
function font(g: G, weight: number, size: number, italic = false) {
  g.font = `${italic ? "italic " : ""}${weight} ${size}px ${FONT}`;
}
function spaced(g: G, text: string, x: number, y: number, sp: number, align: "left" | "center" | "right") {
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = g.textAlign;
  g.textAlign = "left";
  chars.forEach((c, i) => {
    g.fillText(c, cx, y);
    cx += widths[i] + sp;
  });
  g.textAlign = prev;
  return total;
}
function wrap(g: G, text: string, maxW: number) {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
/** Shrinks text until it fits in maxLines; the last line is cut with an ellipsis if it still doesn't. */
function fit(g: G, text: string, maxW: number, size: number, min: number, maxLines: number, weight: number, italic = false) {
  for (let s = size; s >= min; s -= 2) {
    font(g, weight, s, italic);
    const l = wrap(g, text, maxW);
    if (l.length <= maxLines) return { size: s, lines: l };
  }
  font(g, weight, min, italic);
  const l = wrap(g, text, maxW).slice(0, maxLines);
  l[l.length - 1] = ellipsize(g, l[l.length - 1] + "…", maxW);
  return { size: min, lines: l };
}
function ellipsize(g: G, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text.replace(/…$/, "");
  while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}
function foilGrad(g: G, x0: number, y0: number, x1: number, y1: number, base: string) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, shade(base, 0.25));
  gr.addColorStop(0.5, base);
  gr.addColorStop(1, shade(base, -0.25));
  return gr;
}
function emboss(g: G, fn: () => void) {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowOffsetY = 2;
  g.shadowBlur = 2;
  fn();
  g.restore();
}
function diamond(g: G, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
}
function circle(g: G, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}
function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function headphones(g: G, cx: number, cy: number, s: number, color: string, lw: number) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = lw;
  g.lineCap = "round";
  g.beginPath();
  g.arc(cx, cy + s * 0.15, s * 0.55, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  roundRect(g, cx - s * 0.62, cy + s * 0.05, s * 0.26, s * 0.42, s * 0.08);
  g.fill();
  roundRect(g, cx + s * 0.36, cy + s * 0.05, s * 0.26, s * 0.42, s * 0.08);
  g.fill();
  g.restore();
}
const surname = (author: string) => author.split(/[,;&]| and /)[0].trim().split(/\s+/).slice(-1)[0] ?? "";

/* ---------- books ---------- */
export const TW = 1024;
const coverH = (b: ShelfBook) => Math.round((TW * b.size.H) / b.size.W);

/** Spine cloth and foil: from the cover's edge when there is one, else the book's cloth colour. */
export function spineColours(b: ShelfBook, cover: CoverImage | null) {
  if (!cover) return { base: b.cloth.cloth, foil: b.cloth.foil };
  return { base: cover.tone, foil: cover.ink === "#2b2119" ? "#3a2a1c" : "#e3cf9a" };
}

export function drawFront(b: ShelfBook, cover: CoverImage | null) {
  const ch = coverH(b);
  const c = mk(TW, ch);
  const g = ctx(c);
  if (cover) {
    const { img } = cover;
    const s = Math.max(TW / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    g.drawImage(img, (TW - w) / 2, (ch - h) / 2, w, h);
    // The hinge and a little wear, so a photo reads as a printed cover.
    const hinge = g.createLinearGradient(0, 0, 90, 0);
    hinge.addColorStop(0, "rgba(0,0,0,0.38)");
    hinge.addColorStop(0.55, "rgba(255,255,255,0.08)");
    hinge.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hinge;
    g.fillRect(0, 0, 90, ch);
    grain(g, TW, ch, 0.1);
    return c;
  }
  const foil = b.cloth.foil;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  weave(g, TW, ch, b.cloth.cloth);
  g.strokeStyle = foilGrad(g, 0, 0, TW, ch, foil);
  g.lineWidth = 5;
  g.strokeRect(58, 58, TW - 116, ch - 116);
  g.lineWidth = 2;
  g.strokeRect(78, 78, TW - 156, ch - 156);
  g.fillStyle = foilGrad(g, 0, 0, TW, ch, foil);
  for (const [x, y] of [
    [78, 78],
    [TW - 78, 78],
    [78, ch - 78],
    [TW - 78, ch - 78],
  ])
    diamond(g, x, y, 14);
  const t = fit(g, b.title, 760, 92, 48, 4, 600);
  const ty = ch * 0.36 - (t.lines.length - 1) * t.size * 0.55;
  emboss(g, () => t.lines.forEach((l, i) => g.fillText(l, 512, ty + i * t.size * 1.1)));
  const oy = ty + t.lines.length * t.size * 1.1 + 30;
  g.fillRect(352, oy, 120, 3);
  g.fillRect(552, oy, 120, 3);
  diamond(g, 512, oy + 1, 12);
  if (b.author) {
    const a = fit(g, b.author, 760, 42, 30, 2, 400, true);
    emboss(g, () => a.lines.forEach((l, i) => g.fillText(l, 512, ch * 0.8 + i * a.size * 1.2)));
  }
  return c;
}

export function drawSpine(b: ShelfBook, cover: CoverImage | null) {
  const ch = coverH(b);
  const sw = Math.max(96, Math.round((TW * b.size.T) / b.size.W));
  const c = mk(sw, ch);
  const g = ctx(c);
  const { base, foil } = spineColours(b, cover);
  weave(g, sw, ch, base, cover ? 0.6 : 1);
  const fg = foilGrad(g, 0, 0, sw, ch, foil);
  g.fillStyle = fg;
  g.fillRect(18, 80, sw - 36, 5);
  g.fillRect(18, 96, sw - 36, 2);
  g.fillRect(18, ch - 85, sw - 36, 5);
  g.fillRect(18, ch - 98, sw - 36, 2);
  diamond(g, sw / 2, ch - 150, 11);
  g.save();
  g.translate(sw / 2, ch / 2);
  g.rotate(HALF);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = fg;
  let s = Math.min(sw * 0.46, 64);
  font(g, 600, s);
  const maxLen = ch * 0.58;
  while (g.measureText(b.title).width > maxLen && s > 26) {
    s -= 2;
    font(g, 600, s);
  }
  const title = ellipsize(g, b.title, maxLen);
  emboss(g, () => g.fillText(title, -ch * 0.07, 0));
  const last = surname(b.author);
  if (last) {
    font(g, 400, Math.min(sw * 0.3, 40), true);
    const a = ellipsize(g, last, ch * 0.16);
    emboss(g, () => g.fillText(a, ch * 0.33, 0));
  }
  g.restore();
  return c;
}

function sticker(g: G, cx: number, cy: number, R: number, b: ShelfBook) {
  const a = b.audio;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  if (a.kind === "ready") {
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 14;
    g.shadowOffsetY = 4;
    const gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    gr.addColorStop(0, "#e6c681");
    gr.addColorStop(1, "#a87b37");
    g.fillStyle = gr;
    circle(g, cx, cy, R);
    g.shadowColor = "transparent";
    g.strokeStyle = "rgba(43,33,25,0.55)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R - 16, 0, TAU);
    g.stroke();
    headphones(g, cx, cy - 92, 76, INK, 9);
    g.fillStyle = INK;
    font(g, 700, 50);
    g.fillText(duration(a.durationMs) ?? "Synced", cx, cy + 20);
    font(g, 600, 21);
    spaced(g, "LISTEN ALONG", cx, cy + 62, 4, "center");
    if (a.coverage !== null) {
      font(g, 400, 26, true);
      g.fillText(`${pct(a.coverage)} synced`, cx, cy + 102);
    }
  } else if (a.kind === "syncing" || a.kind === "queued") {
    const p = a.kind === "syncing" ? a.pct : 0;
    g.shadowColor = "rgba(0,0,0,0.4)";
    g.shadowBlur = 12;
    g.shadowOffsetY = 3;
    g.fillStyle = PAPER;
    circle(g, cx, cy, R);
    g.shadowColor = "transparent";
    g.lineWidth = 16;
    g.strokeStyle = "rgba(43,33,25,0.14)";
    g.beginPath();
    g.arc(cx, cy, R - 26, 0, TAU);
    g.stroke();
    if (p > 0) {
      g.strokeStyle = BRASS;
      g.lineCap = "round";
      g.beginPath();
      g.arc(cx, cy, R - 26, -HALF, -HALF + (TAU * p) / 100);
      g.stroke();
    }
    headphones(g, cx, cy - 74, 58, "rgba(43,33,25,0.55)", 7);
    g.fillStyle = INK;
    if (a.kind === "syncing") {
      font(g, 700, 54);
      g.fillText(`${p}%`, cx, cy + 30);
      font(g, 600, 19);
      spaced(g, "SYNCING AUDIO", cx, cy + 68, 3, "center");
    } else {
      font(g, 600, 22);
      spaced(g, "WAITING", cx, cy + 22, 4, "center");
      font(g, 400, 26, true);
      g.fillStyle = INK2;
      g.fillText("to sync the audio", cx, cy + 60);
    }
  } else if (a.kind === "uploading") {
    g.fillStyle = "rgba(239,228,207,0.92)";
    circle(g, cx, cy, R);
    g.setLineDash([10, 10]);
    g.lineWidth = 4;
    g.strokeStyle = INK2;
    g.beginPath();
    g.arc(cx, cy, R - 18, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    headphones(g, cx, cy - 66, 58, INK2, 7);
    g.fillStyle = INK;
    font(g, 600, 22);
    spaced(g, "UPLOADING", cx, cy + 22, 4, "center");
    font(g, 400, 30, true);
    g.fillStyle = INK2;
    g.fillText(`${a.pct}%`, cx, cy + 64);
  } else if (a.kind === "error") {
    g.fillStyle = "rgba(239,228,207,0.9)";
    circle(g, cx, cy, R);
    g.strokeStyle = OX;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, R - 18, 0, TAU);
    g.stroke();
    headphones(g, cx, cy - 66, 58, OX, 7);
    g.fillStyle = OX;
    font(g, 600, 22);
    spaced(g, "SYNC FAILED", cx, cy + 22, 3, "center");
    font(g, 400, 24, true);
    g.fillText("add the audio again", cx, cy + 60);
  } else {
    g.globalAlpha = 0.55;
    g.strokeStyle = BRASS;
    g.setLineDash([6, 10]);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R - 20, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = BRASS;
    font(g, 600, 22);
    spaced(g, "TEXT ONLY", cx, cy + 4, 4, "center");
    font(g, 400, 22, true);
    g.fillText("no audiobook yet", cx, cy + 40);
  }
  g.restore();
}

export function drawBack(b: ShelfBook, cover: CoverImage | null) {
  const ch = coverH(b);
  const c = mk(TW, ch);
  const g = ctx(c);
  const { base, foil } = spineColours(b, cover);
  weave(g, TW, ch, shade(base, -0.08));
  const px = 70,
    py = 66,
    pw = TW - 140,
    ph = Math.round(ch * 0.535);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.5)";
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  g.fillStyle = PAPER;
  g.fillRect(px, py, pw, ph);
  g.restore();
  g.save();
  g.beginPath();
  g.rect(px, py, pw, ph);
  g.clip();
  grain(g, TW, ch, 0.12);
  g.restore();
  g.fillStyle = OX;
  g.textAlign = "left";
  font(g, 600, 24);
  spaced(g, ellipsize(g, b.title.toUpperCase(), pw - 200), px + 54, py + 74, 4, "left");
  g.fillRect(px + 54, py + 96, 90, 3);
  const text = b.description?.trim();
  if (text) {
    let size = 41;
    let lines: string[] = [];
    const room = ph - 220;
    for (; size >= 24; size -= 1) {
      font(g, 400, size);
      lines = text.split(/\n+/).flatMap((p) => wrap(g, p, pw - 108));
      if (lines.length * size * 1.5 < room) break;
    }
    const max = Math.floor(room / (size * 1.5));
    if (lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = ellipsize(g, lines[max - 1] + "…", pw - 108);
    }
    g.fillStyle = INK;
    lines.forEach((l, i) => g.fillText(l, px + 54, py + 160 + i * size * 1.5));
  } else {
    g.fillStyle = INK2;
    font(g, 400, 32, true);
    g.fillText("No description.", px + 54, py + 170);
  }
  if (b.author) {
    font(g, 400, 28, true);
    g.fillStyle = INK2;
    g.fillText(ellipsize(g, "— " + b.author, pw - 108), px + 54, py + ph - 44);
  }
  sticker(g, 250, ch - 300, 172, b);
  g.fillStyle = shade(foil, -0.1);
  g.globalAlpha = 0.8;
  font(g, 600, 18);
  spaced(g, "LOAM · PERSONAL LIBRARY", 250, ch - 58, 4, "center");
  g.globalAlpha = 1;
  return c;
}

function stamp(g: G, b: ShelfBook) {
  if (b.guest) return;
  const ai = b.ai;
  g.save();
  if (ai.kind === "done") {
    g.translate(398, 262);
    g.rotate(-0.24);
    g.strokeStyle = g.fillStyle = "rgba(122,39,49,0.88)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 104, 0, TAU);
    g.stroke();
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(0, 0, 90, 0, TAU);
    g.stroke();
    g.textAlign = "center";
    font(g, 700, 21);
    spaced(g, "ANNOTATED", 0, -34, 3, "center");
    spaced(g, "BY LOAM", 0, -8, 3, "center");
    if (ai.terms !== null) {
      font(g, 700, 46);
      g.fillText(String(ai.terms), 0, 42);
      font(g, 600, 18);
      spaced(g, ai.terms === 1 ? "TERM" : "TERMS", 0, 66, 4, "center");
    } else diamond(g, 0, 34, 12);
  } else if (ai.kind === "running") {
    g.translate(392, 268);
    g.rotate(-0.1);
    g.strokeStyle = g.fillStyle = "rgba(52,78,110,0.85)";
    g.setLineDash([12, 8]);
    g.lineWidth = 4;
    g.strokeRect(-104, -64, 208, 128);
    g.setLineDash([]);
    g.textAlign = "center";
    font(g, 700, 20);
    spaced(g, "BEING ANNOTATED", 0, -26, 2, "center");
    font(g, 400, 22, true);
    g.fillText("finding terms", 0, 4);
    g.lineWidth = 2;
    g.strokeRect(-80, 22, 160, 18);
    g.fillRect(-80, 22, (160 * ai.pct) / 100, 18);
    font(g, 700, 18);
    g.fillText(ai.pct + "%", 0, 60);
  } else {
    const failed = ai.kind === "error";
    g.translate(392, 262);
    g.rotate(-0.08);
    g.strokeStyle = g.fillStyle = failed ? "rgba(122,39,49,0.8)" : "rgba(80,80,90,0.7)";
    g.lineWidth = 4;
    g.strokeRect(-110, -42, 220, 84);
    g.textAlign = "center";
    font(g, 700, 19);
    spaced(g, failed ? "NOT ANNOTATED" : "IN THE QUEUE", 0, -6, 2, "center");
    font(g, 400, 19, true);
    g.fillText(failed ? "the term pass failed" : "term pass not started", 0, 24);
  }
  g.restore();
  g.save();
  g.globalCompositeOperation = "destination-out";
  const r = rng(7);
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = r() * 0.6;
    g.fillRect(240 + r() * 270, 160 + r() * 260, 2 + r() * 3, 2 + r() * 2);
  }
  g.restore();
}

export function drawCard(b: ShelfBook) {
  const c = mk(512, 634);
  const g = ctx(c);
  const ink = mk(512, 634);
  g.fillStyle = "#f4ecda";
  g.fillRect(0, 0, 512, 634);
  grain(g, 512, 634, 0.12);
  g.fillStyle = OX;
  g.fillRect(0, 0, 512, 10);
  font(g, 700, 22);
  spaced(g, "LOAM · READING CARD", 34, 52, 3, "left");
  const t = fit(g, b.title, 444, 30, 22, 1, 400, true);
  g.fillStyle = INK;
  g.fillText(t.lines[0], 34, 96);
  g.strokeStyle = "rgba(90,120,160,0.45)";
  g.lineWidth = 1.5;
  for (let y = 118; y < 620; y += 52) {
    g.beginPath();
    g.moveTo(24, y);
    g.lineTo(488, y);
    g.stroke();
  }
  g.strokeStyle = "rgba(122,39,49,0.4)";
  g.beginPath();
  g.moveTo(186, 118);
  g.lineTo(186, 620);
  g.stroke();
  const x = b.extras;
  const n = (v: number | undefined) => (v ? String(v) : "—");
  const a = b.audio;
  const audio =
    a.kind === "ready"
      ? a.coverage !== null
        ? `synced · ${pct(a.coverage)}`
        : "synced"
      : a.kind === "syncing"
        ? `syncing · ${a.pct}%`
        : a.kind === "queued"
          ? "waiting to sync"
          : a.kind === "uploading"
            ? `uploading · ${a.pct}%`
            : a.kind === "error"
              ? "sync failed"
              : "—";
  const rows: [string, string][] = b.guest
    ? [["Audiobook", a.kind === "ready" ? duration(a.durationMs) ?? "Available" : "None"]]
    : [
    ["Reading", progressLabel(b)],
    ["Highlights", n(x?.highlights)],
    ["Notes", n(x?.notes)],
    ["Questions", n(x?.questions)],
    ["Looked up", x?.lookedUp ? `${x.lookedUp} ${x.lookedUp === 1 ? "term" : "terms"}` : "—"],
    ["Story so far", x?.recap ? "ready" : "—"],
    ["Audiobook", audio],
    ["Added", addedLabel(b.addedAt)],
  ];
  rows.forEach(([k, v], i) => {
    const yy = 158 + i * 52;
    g.fillStyle = INK2;
    font(g, 400, 22, true);
    g.fillText(k, 34, yy);
    g.fillStyle = INK;
    font(g, 600, 24);
    g.fillText(ellipsize(g, v, 290), 200, yy);
  });
  stamp(ctx(ink), b);
  g.drawImage(ink, 0, 0);
  return c;
}

export function drawPocket() {
  const c = mk(560, 330);
  const g = ctx(c);
  g.fillStyle = "#b98b57";
  g.beginPath();
  g.moveTo(0, 30);
  g.lineTo(200, 30);
  g.quadraticCurveTo(280, 110, 360, 30);
  g.lineTo(560, 30);
  g.lineTo(560, 330);
  g.lineTo(0, 330);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  grain(g, 560, 330, 0.3);
  g.restore();
  g.strokeStyle = "rgba(60,36,20,0.4)";
  g.lineWidth = 2;
  g.setLineDash([6, 6]);
  g.strokeRect(22, 70, 516, 236);
  g.setLineDash([]);
  g.fillStyle = "#3c2414";
  g.textAlign = "center";
  font(g, 700, 24);
  spaced(g, "LOAM", 280, 160, 8, "center");
  font(g, 400, 24, true);
  g.fillText("your reading card", 280, 204);
  font(g, 600, 17);
  spaced(g, "PULL TO READ IT", 280, 260, 3, "center");
  return c;
}

export function drawRibbon(color: string) {
  const c = mk(32, 256);
  const g = ctx(c);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(32, 0);
  g.lineTo(32, 256);
  g.lineTo(16, 228);
  g.lineTo(0, 256);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(6, 0, 3, 240);
  return c;
}

export function drawEdge(vertical: boolean) {
  const w = vertical ? 256 : 1024;
  const h = vertical ? 1024 : 256;
  const c = mk(w, h);
  const g = ctx(c);
  const r = rng(5);
  g.fillStyle = "#e8dbbe";
  g.fillRect(0, 0, w, h);
  const n = vertical ? w : h;
  for (let i = 0; i < n; i += 2) {
    g.fillStyle = `rgba(90,70,40,${0.04 + r() * 0.1})`;
    if (vertical) g.fillRect(i, 0, 1, h);
    else g.fillRect(0, i, w, 1);
  }
  const gr = vertical ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "rgba(60,40,20,0.25)");
  gr.addColorStop(0.08, "rgba(0,0,0,0)");
  gr.addColorStop(0.92, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(60,40,20,0.25)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  return c;
}

/* ---------- preview pages ---------- */
const PM = { top: 150, bottom: 150, side: 112 };
const PFS = 33;
const PLH = 53;

type Word = { w: string; marked: boolean };
type Line = { words: Word[]; indent: number; last: boolean; wsum: number };
export type Page =
  | { kind: "title" }
  | { kind: "end" }
  | { kind: "blank" }
  | { kind: "loading" }
  | { kind: "text"; lines: Line[]; heading: string | null; first: boolean };

/** Lays the opening paragraphs out into pages. A short first paragraph becomes the chapter heading. */
export function paginate(paras: PreviewPara[] | null, ph: number): Page[] {
  if (!paras) return [{ kind: "title" }, { kind: "loading" }];
  const g = ctx(mk(8, 8));
  font(g, 400, PFS);
  const maxW = TW - PM.side * 2;
  const space = g.measureText(" ").width;
  let heading: string | null = null;
  let body = paras;
  if (paras.length > 1 && paras[0].words.length <= 8) {
    heading = paras[0].words.join(" ");
    body = paras.slice(1);
  }
  const lines: Line[] = [];
  body.forEach((p, pi) => {
    const indent = pi > 0 ? 46 : 0;
    let cur: Word[] = [];
    let wsum = 0;
    let curIndent = indent;
    p.words.forEach((w, i) => {
      const ww = g.measureText(w).width;
      if (cur.length && wsum + space * cur.length + ww > maxW - curIndent) {
        lines.push({ words: cur, indent: curIndent, last: false, wsum });
        cur = [];
        wsum = 0;
        curIndent = 0;
      }
      cur.push({ w, marked: p.marked[i] });
      wsum += ww;
    });
    if (cur.length) lines.push({ words: cur, indent: curIndent, last: true, wsum });
  });
  const per = Math.floor((ph - PM.top - PM.bottom) / PLH);
  const pages: Page[] = [{ kind: "title" }];
  let i = 0;
  let first = true;
  while (i < lines.length) {
    const cap = first ? per - 5 : per;
    pages.push({ kind: "text", lines: lines.slice(i, i + cap), heading: first ? heading : null, first });
    i += cap;
    first = false;
  }
  pages.push({ kind: "end" });
  if (pages.length % 2) pages.push({ kind: "blank" });
  return pages;
}

function paperBase(g: G, ph: number, side: "left" | "right") {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, TW, ph);
  grain(g, TW, ph, 0.1);
  const gr = side === "left" ? g.createLinearGradient(TW, 0, TW - 180, 0) : g.createLinearGradient(0, 0, 180, 0);
  gr.addColorStop(0, "rgba(70,45,20,0.32)");
  gr.addColorStop(1, "rgba(70,45,20,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, TW, ph);
  const e = side === "left" ? g.createLinearGradient(0, 0, 40, 0) : g.createLinearGradient(TW, 0, TW - 40, 0);
  e.addColorStop(0, "rgba(70,45,20,0.12)");
  e.addColorStop(1, "rgba(70,45,20,0)");
  g.fillStyle = e;
  g.fillRect(0, 0, TW, ph);
}

/** Lines for the last page: where you are, the audio, and Loam's pass. */
export function endNotes(b: ShelfBook) {
  if (b.guest) return b.audio.kind === "ready" ? ["An audiobook is available."] : [];
  const items: string[] = [];
  items.push(finished(b) ? "You finished this one." : b.started ? `Your place: ${progressLabel(b)}.` : "You haven't started it yet.");
  const a = b.audio;
  items.push(
    a.kind === "ready"
      ? `The audiobook is synced${a.durationMs ? `, ${duration(a.durationMs)}` : ""}.`
      : a.kind === "syncing"
        ? `The audiobook is syncing, ${a.pct}%.`
        : a.kind === "queued"
          ? "The audiobook is waiting to sync."
          : a.kind === "uploading"
            ? `The audiobook is uploading, ${a.pct}%.`
            : a.kind === "error"
              ? "The audiobook didn't sync."
              : "No audiobook for this one yet.",
  );
  const ai = b.ai;
  items.push(
    ai.kind === "done"
      ? ai.terms
        ? `Loam marked ${ai.terms} ${ai.terms === 1 ? "term" : "terms"} you can tap to learn more.`
        : "Loam has read it."
      : ai.kind === "running"
        ? `Loam is finding terms, ${ai.pct}%.`
        : ai.kind === "error"
          ? "Loam couldn't mark terms in this one."
          : "Terms appear once Loam has read it.",
  );
  return items;
}

export function drawPage(b: ShelfBook, page: Page, num: number, side: "left" | "right", ph: number) {
  const c = mk(TW, ph);
  const g = ctx(c);
  paperBase(g, ph, side);
  g.textAlign = "center";
  g.fillStyle = INK2;
  if (page.kind === "title") {
    g.fillStyle = OX;
    font(g, 600, 22);
    spaced(g, "FIRST PAGES", 512, ph * 0.22, 6, "center");
    g.fillStyle = INK;
    const t = fit(g, b.title, 760, 70, 40, 4, 600);
    let y = ph * 0.36;
    t.lines.forEach((l, i) => g.fillText(l, 512, y + i * t.size * 1.12));
    y += t.lines.length * t.size * 1.12 + 10;
    g.fillStyle = OX;
    diamond(g, 512, y, 9);
    g.fillRect(412, y - 1.5, 70, 3);
    g.fillRect(542, y - 1.5, 70, 3);
    if (b.author) {
      g.fillStyle = INK;
      const a = fit(g, b.author, 760, 40, 28, 2, 400, true);
      a.lines.forEach((l, i) => g.fillText(l, 512, y + 80 + i * a.size * 1.2));
    }
    g.fillStyle = INK2;
    font(g, 400, 26, true);
    g.fillText("Read a little before you start.", 512, ph * 0.86);
    return c;
  }
  if (page.kind === "loading") {
    g.fillStyle = INK2;
    font(g, 400, 32, true);
    g.fillText("Opening the first pages…", 512, ph * 0.45);
    return c;
  }
  if (page.kind === "end") {
    const y2 = ph * 0.3;
    g.fillStyle = OX;
    diamond(g, 482, y2, 8);
    diamond(g, 512, y2, 8);
    diamond(g, 542, y2, 8);
    g.fillStyle = INK;
    font(g, 400, 40, true);
    g.fillText("The preview ends here.", 512, y2 + 90);
    font(g, 400, 29);
    let yy = y2 + 190;
    for (const it of endNotes(b)) {
      for (const l of wrap(g, it, 700)) {
        g.fillText(l, 512, yy);
        yy += 46;
      }
      yy += 26;
    }
    return c;
  }
  if (page.kind === "blank") {
    g.fillStyle = "rgba(122,39,49,0.25)";
    diamond(g, 512, ph / 2, 10);
    return c;
  }
  font(g, 600, 18);
  g.fillStyle = INK2;
  spaced(g, ellipsize(g, (side === "left" ? b.author || b.title : b.title).toUpperCase(), 640), 512, 90, 4, "center");
  font(g, 400, 24);
  g.fillText(String(num), 512, ph - 70);
  let y3 = PM.top + 20;
  if (page.first) {
    g.fillStyle = OX;
    if (page.heading) {
      const h = fit(g, page.heading, 760, 44, 30, 2, 400, true);
      h.lines.forEach((l, i) => g.fillText(l, 512, y3 + 80 + i * h.size * 1.2));
    } else {
      diamond(g, 512, y3 + 90, 9);
      g.fillRect(412, y3 + 88.5, 70, 3);
      g.fillRect(542, y3 + 88.5, 70, 3);
    }
    y3 += 5 * PLH;
  }
  font(g, 400, PFS);
  g.textAlign = "left";
  g.fillStyle = INK;
  const maxW = TW - PM.side * 2;
  const space = g.measureText(" ").width;
  page.lines.forEach((ln, i) => {
    const y = y3 + i * PLH;
    let x = PM.side + ln.indent;
    const n = ln.words.length;
    let gap = !ln.last && n > 1 ? (maxW - ln.indent - ln.wsum) / (n - 1) : space;
    if (gap > space * 3) gap = space;
    for (const { w, marked } of ln.words) {
      const ww = g.measureText(w).width;
      if (marked) {
        g.save();
        g.fillStyle = "rgba(196,154,82,0.22)";
        g.fillRect(x - 4, y - PFS + 2, ww + 8, PFS + 12);
        g.strokeStyle = "#9a6c2a";
        g.lineWidth = 4;
        g.setLineDash([2, 6]);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x, y + 11);
        g.lineTo(x + ww, y + 11);
        g.stroke();
        g.restore();
      }
      g.fillText(w, x, y);
      x += ww + gap;
    }
  });
  return c;
}

/* ---------- room ---------- */
export function floorTex() {
  const c = mk(1024, 1024);
  const g = ctx(c);
  const r = rng(3);
  const cols = ["#3b2416", "#33200f", "#402818", "#36210f", "#3d2717"];
  for (let i = 0; i < 8; i++) {
    const y = i * 128;
    const off = (i % 2) * 380 + r() * 200;
    for (let x = -off; x < 1024; x += 760) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x, y, 760, 128);
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(x, y, 3, 128);
    }
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, y, 1024, 3);
    g.strokeStyle = "rgba(0,0,0,0.18)";
    g.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      const yy = y + 12 + r() * 104;
      const p = r() * 6;
      g.moveTo(0, yy);
      for (let xx = 0; xx <= 1024; xx += 32) g.lineTo(xx, yy + Math.sin(xx / 90 + p) * 3);
      g.stroke();
    }
  }
  grain(g, 1024, 1024, 0.2);
  return c;
}
export function plasterTex(base: string) {
  const c = mk(512, 512);
  const g = ctx(c);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  grain(g, 512, 512, 0.22);
  return c;
}
export function grainWood(base: string) {
  const c = mk(512, 512);
  const g = ctx(c);
  const r = rng(11);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(0,0,0,0.22)";
  g.lineWidth = 1.2;
  for (let k = 0; k < 40; k++) {
    g.beginPath();
    const y = r() * 512;
    const p = r() * 6;
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x / 70 + p) * 4);
    g.stroke();
  }
  grain(g, 512, 512, 0.15);
  return c;
}
export function rugTex() {
  const c = mk(1024, 680);
  const g = ctx(c);
  g.fillStyle = "#5a1d23";
  g.fillRect(0, 0, 1024, 680);
  g.strokeStyle = "#d9c7a3";
  g.lineWidth = 6;
  g.strokeRect(30, 30, 964, 620);
  g.lineWidth = 2;
  g.strokeRect(52, 52, 920, 576);
  g.strokeStyle = "rgba(201,150,80,0.55)";
  g.lineWidth = 3;
  for (let x = 90; x < 960; x += 64)
    for (let y = 90; y < 620; y += 64) {
      g.beginPath();
      g.moveTo(x, y - 22);
      g.lineTo(x + 22, y);
      g.lineTo(x, y + 22);
      g.lineTo(x - 22, y);
      g.closePath();
      g.stroke();
    }
  g.fillStyle = "#d9c7a3";
  for (let i = 0; i < 30; i++) {
    g.fillRect(i * 34 + 10, 0, 3, 22);
    g.fillRect(i * 34 + 10, 658, 3, 22);
  }
  grain(g, 1024, 680, 0.35);
  return c;
}
export function printA() {
  const c = mk(512, 700);
  const g = ctx(c);
  g.fillStyle = "#e9dcc2";
  g.fillRect(0, 0, 512, 700);
  grain(g, 512, 700, 0.15);
  g.fillStyle = OX;
  g.textAlign = "center";
  font(g, 600, 150);
  g.fillText("Read", 256, 300);
  font(g, 400, 128, true);
  g.fillText("slowly.", 256, 440);
  g.fillStyle = INK;
  g.fillRect(206, 500, 100, 3);
  font(g, 600, 20);
  spaced(g, "A NOTE TO SELF", 256, 560, 5, "center");
  return c;
}
export function printB() {
  const c = mk(512, 660);
  const g = ctx(c);
  g.fillStyle = "#1f2a24";
  g.fillRect(0, 0, 512, 660);
  g.fillStyle = "#d9a441";
  g.beginPath();
  g.arc(256, 330, 150, Math.PI, 0);
  g.fill();
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#3d2a1b" : "#6b4a2c";
    g.fillRect(0, 330 + i * 40, 512, 40);
  }
  g.fillStyle = "#e9dcc2";
  g.textAlign = "center";
  font(g, 600, 20);
  spaced(g, "LOAM", 256, 120, 14, "center");
  grain(g, 512, 660, 0.2);
  return c;
}
export function nightTex() {
  const c = mk(512, 800);
  const g = ctx(c);
  const r = rng(21);
  const gr = g.createLinearGradient(0, 0, 0, 800);
  gr.addColorStop(0, "#0d1626");
  gr.addColorStop(1, "#1c2b44");
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 800);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(220,230,255,${0.2 + r() * 0.5})`;
    g.fillRect(r() * 512, r() * 500, 2, 2);
  }
  const mg = g.createRadialGradient(360, 180, 10, 360, 180, 200);
  mg.addColorStop(0, "rgba(220,228,255,0.5)");
  mg.addColorStop(1, "rgba(220,228,255,0)");
  g.fillStyle = mg;
  g.fillRect(0, 0, 512, 800);
  g.fillStyle = "#dfe6f5";
  circle(g, 360, 180, 26);
  g.fillStyle = "#0a1019";
  g.beginPath();
  g.moveTo(0, 800);
  for (let x = 0; x <= 512; x += 16) g.lineTo(x, 640 - Math.sin(x / 60) * 30 - r() * 40);
  g.lineTo(512, 800);
  g.fill();
  return c;
}
/** The cassette's label: the held book when its audiobook is synced. */
export function cassetteTex(b: ShelfBook | null) {
  const c = mk(512, 330);
  const g = ctx(c);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, 512, 330);
  g.fillStyle = b ? b.cloth.cloth : OX;
  g.fillRect(0, 0, 512, 70);
  g.fillStyle = PAPER;
  font(g, 600, 30);
  g.textAlign = "center";
  g.fillText(b ? ellipsize(g, b.title, 470) : "Loam", 256, 48);
  g.fillStyle = "#2a1d14";
  roundRect(g, 96, 120, 320, 120, 60);
  g.fill();
  g.fillStyle = "#5a4a3a";
  circle(g, 176, 180, 44);
  circle(g, 336, 180, 44);
  g.fillStyle = INK;
  font(g, 400, 26, true);
  const d = b && b.audio.kind === "ready" ? duration(b.audio.durationMs) : null;
  g.fillText(b ? (d ? `${d} · synced` : "synced") : "nothing loaded", 256, 300);
  return c;
}
/** The index card on the side table when a review is due. */
export function reviewCardTex(due: number) {
  const c = mk(512, 340);
  const g = ctx(c);
  g.fillStyle = "#f4ecda";
  g.fillRect(0, 0, 512, 340);
  grain(g, 512, 340, 0.12);
  g.fillStyle = OX;
  g.fillRect(0, 0, 512, 10);
  g.strokeStyle = "rgba(90,120,160,0.45)";
  g.lineWidth = 1.5;
  for (let y = 120; y < 330; y += 48) {
    g.beginPath();
    g.moveTo(20, y);
    g.lineTo(492, y);
    g.stroke();
  }
  g.fillStyle = OX;
  g.textAlign = "center";
  font(g, 700, 30);
  spaced(g, "TODAY'S REVIEW", 256, 80, 4, "center");
  g.fillStyle = INK;
  font(g, 600, 90);
  g.fillText(String(due), 256, 228);
  font(g, 400, 30, true);
  g.fillText(due === 1 ? "card due" : "cards due", 256, 290);
  return c;
}
