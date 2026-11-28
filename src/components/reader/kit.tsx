"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The reader's controls, so every panel uses the same sizes.
 *
 * Type scale (px): 12 meta and labels · 14 interface text and buttons · 16 reading text in panels
 * · 18 panel titles · 24 display. Icons: 16 beside 14px text, 18 in bars and on icon buttons.
 * Heights: 32 (small), 36 (default); every control grows to 44 on touch screens.
 */

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background";
const base = cn(
  "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-colors duration-150 select-none",
  "disabled:pointer-events-none disabled:opacity-45",
  focus,
);

type ButtonProps = ComponentProps<"button">;

const TONE = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88",
  quiet: "border border-border text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

type BtnStyle = { tone?: keyof typeof TONE; size?: "sm" | "md"; icon?: boolean; className?: string };

/** Btn's classes, for a link that looks like one. */
export function btnClass({ tone = "quiet", size = "md", icon, className }: BtnStyle = {}) {
  return cn(
    base,
    TONE[tone],
    "gap-2 rounded-lg text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0",
    size === "md" ? "h-9 px-3.5" : "h-8 px-3",
    "pointer-coarse:h-11 pointer-coarse:px-4",
    icon && (size === "md" ? "pl-3" : "pl-2.5"),
    className,
  );
}

/** A labelled button: primary (one per view), quiet (outlined), or ghost. Icons go first, at 16px. */
export function Btn({
  tone,
  size,
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps & { tone?: keyof typeof TONE; size?: "sm" | "md"; icon?: ReactNode }) {
  return (
    <button type={type} className={btnClass({ tone, size, icon: !!icon, className })} {...props}>
      {icon}
      {children}
    </button>
  );
}

/**
 * An icon-only button. "md" (36px, 18px icon) for bars and panel headers, "sm" (32px, 16px icon)
 * for actions inside a list entry. Both are 44px on touch screens.
 */
export function IconBtn({
  label,
  size = "md",
  tone = "ghost",
  active,
  className,
  type = "button",
  ...props
}: ButtonProps & { label: string; size?: "sm" | "md"; tone?: "ghost" | "primary"; active?: boolean }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        base,
        "rounded-lg",
        size === "md" ? "size-9 [&_svg]:size-[18px]" : "size-8 [&_svg]:size-4",
        "pointer-coarse:size-11",
        tone === "primary" ? TONE.primary : TONE.ghost,
        active && "bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A pill that toggles (a filter), with an optional count. */
export function Chip({ pressed, count, className, children, ...props }: ButtonProps & { pressed: boolean; count?: number }) {
  // Counts are left out on touch screens, where four 44px pills with counts don't fit across a panel.
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        base,
        "h-8 gap-1.5 rounded-full border px-2.5 text-sm pointer-coarse:h-11 pointer-coarse:px-3",
        pressed
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className={cn("text-xs tabular-nums pointer-coarse:hidden", pressed ? "opacity-80" : "opacity-70")}>{count}</span>}
    </button>
  );
}

/** Two or three options side by side, one chosen: theme, or the companion's two views (as tabs). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tabs,
  className,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Tabs switch views; otherwise it's a choice (radio group). */
  tabs?: boolean;
  className?: string;
}) {
  return (
    <div role={tabs ? "tablist" : "radiogroup"} aria-label={label} className={cn("flex gap-1 rounded-lg bg-muted p-1", className)}>
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            onClick={() => !on && onChange(v)}
            className={cn(
              base,
              "h-8 min-w-0 flex-1 rounded-md px-3 text-sm pointer-coarse:h-11",
              on ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A text field's shared look (inputs and textareas in panels). 16px on touch screens, so iOS doesn't zoom. */
export const field = cn(
  "w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors duration-150",
  "placeholder:text-muted-foreground focus:border-ring/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/15 pointer-coarse:text-base",
);
