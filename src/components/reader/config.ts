import type { NavItem } from "epubjs";
import type { ReaderTheme } from "@/lib/library";

/** The book's text colour on each page. */
export const INK: Record<ReaderTheme, string> = { paper: "#1c1c1c", sepia: "#3a2e24", night: "#e2d9c9" };
export const THEME_NAMES: Record<ReaderTheme, string> = { paper: "Paper", sepia: "Sepia", night: "Night" };
export const FONT_STEPS = [85, 95, 105, 115, 125, 140, 160];
export const LINE_STEPS = [1.4, 1.55, 1.65, 1.8, 2];
export const IDLE_MS = 2200;

export const SHORTCUTS: [string, string][] = [
  ["←  →", "Previous / next page"],
  ["Space  ⇧Space", "Next / previous page"],
  ["[  ]", "Previous / next chapter"],
  ["C", "Contents"],
  ["M", "Notebook"],
  ["Q", "Ask"],
  ["R", "Recap"],
  ["P", "Show / hide progress"],
  ["−  =", "Smaller / larger text"],
  ["N", "Next theme"],
  ["A", "Show / hide audiobook"],
  ["K", "Play / pause audiobook"],
  ["Esc", "Close panel"],
  ["?", "Keyboard shortcuts"],
];

export type Panel = "toc" | "type" | "keys" | "notebook" | "ask" | "recap";

/** A table-of-contents entry, resolved to its spine section and optional #anchor. */
export type Entry = { label: string; href: string; depth: number; spine: number; hash: string | null };

export function flatten(items: NavItem[], depth = 0): { label: string; href: string; depth: number }[] {
  return items.flatMap((i) => [{ label: i.label.trim(), href: i.href, depth }, ...flatten(i.subitems ?? [], depth + 1)]);
}

/** Next value up/down a fixed scale, tolerating a current value that isn't on it. */
export function step<T>(arr: readonly T[], cur: T, dir: 1 | -1): T {
  const i = arr.indexOf(cur);
  const base = i === -1 ? arr.findIndex((v) => v > cur) : i;
  return arr[Math.max(0, Math.min(arr.length - 1, (base === -1 ? arr.length - 1 : base) + dir))];
}
