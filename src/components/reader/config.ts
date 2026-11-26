import type { NavItem } from "epubjs";

export const INK = { light: "#3a2e24", dark: "#e6dccb" } as const;
export const FONT_STEPS = [85, 95, 105, 115, 125, 140, 160];
export const LINE_STEPS = [1.4, 1.55, 1.65, 1.8, 2];
export const IDLE_MS = 2200;

export const SHORTCUTS: [string, string][] = [
  ["← →  or  Space ⇧Space", "Previous / next page"],
  ["[  ]", "Previous / next chapter"],
  ["C", "Contents"],
  ["M", "Notebook"],
  ["Q", "Ask about the book so far"],
  ["R", "The story so far"],
  ["P", "Show / hide progress"],
  ["−  =", "Smaller / larger text"],
  ["N", "Parchment / night"],
  ["A", "Show / hide the audiobook"],
  ["K", "Play / pause the audiobook"],
  ["Esc", "Close panel"],
  ["?", "Shortcuts"],
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
