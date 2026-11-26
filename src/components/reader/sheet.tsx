"use client";

import { RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Btn, IconBtn } from "./kit";

/*
 * Panels over the page, and the pieces every panel is built from, so they line up the same way:
 * one header, 20px side padding, 16px reading text, 14px interface text, 12px labels.
 */

/**
 * A panel over the page. On phones held upright it slides up from the bottom; on larger screens
 * and sideways phones it is a side panel ("side") or a small card under the top bar ("popover").
 */
export function Sheet({
  title,
  variant,
  onClose,
  children,
}: {
  title: string;
  variant: "side" | "popover";
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 z-30 animate-in bg-scrim duration-200 fade-in sm:bg-transparent short:bg-transparent"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-label={title}
        className={cn(
          "absolute inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-card text-card-foreground pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.18)]",
          "animate-in slide-in-from-bottom-8 fade-in duration-200 sm:animate-none short:animate-none",
          // Tablets, desktops and sideways phones: a full-height panel on the right. Its width grows by
          // the notch on that side (sideways phones), so the content keeps its 24rem.
          variant === "side" && [
            "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-[calc(24rem+env(safe-area-inset-right))] sm:rounded-none sm:border-t-0 sm:border-l sm:pt-[env(safe-area-inset-top)] sm:pr-[env(safe-area-inset-right)] sm:shadow-[-8px_0_24px_-16px_rgb(0_0_0/0.18)]",
            "short:inset-y-0 short:right-0 short:left-auto short:max-h-none short:w-full short:max-w-[calc(min(24rem,62vw)+env(safe-area-inset-right))] short:rounded-none short:border-t-0 short:border-l short:pt-0 short:pr-[env(safe-area-inset-right)] short:shadow-[-8px_0_24px_-16px_rgb(0_0_0/0.18)]",
          ],
          // A card under the top bar's right end, never taller than the screen below the bar.
          variant === "popover" && [
            "sm:top-[calc(3.5rem+env(safe-area-inset-top))] sm:right-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))] sm:bottom-auto sm:left-auto sm:max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-1rem)] sm:w-80 sm:rounded-xl sm:border sm:pb-0 sm:shadow-lg sm:shadow-black/8",
            "short:top-[3.25rem] short:right-[max(0.5rem,calc(env(safe-area-inset-right)+0.5rem))] short:bottom-auto short:left-auto short:max-h-[calc(100dvh-3.25rem-max(0.5rem,env(safe-area-inset-bottom)))] short:w-80 short:rounded-xl short:border short:pb-0 short:shadow-lg short:shadow-black/8",
          ],
        )}
      >
        <SheetHeader title={title} onClose={onClose} className={cn(variant === "popover" && "sm:hidden short:hidden")} />
        {children}
      </section>
    </>
  );
}

/** Title on the left, close on the right, both centred on one 56px line. */
export function SheetHeader({ title, onClose, className }: { title: string; onClose: () => void; className?: string }) {
  return (
    <header className={cn("flex h-14 shrink-0 items-center justify-between gap-3 pr-3 pl-5 pointer-coarse:pr-2", className)}>
      <h2 className="min-w-0 truncate text-lg leading-7 font-semibold tracking-tight">{title}</h2>
      <IconBtn label="Close" onClick={onClose} className="-my-1">
        <X />
      </IconBtn>
    </header>
  );
}

/** The scrolling part of a panel. */
export function SheetBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-6", className)}>{children}</div>;
}

/** Actions pinned under the body. */
export function SheetFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex shrink-0 items-center gap-2 border-t border-border px-5 py-3", className)}>{children}</div>;
}

/** A small label over a group: a chapter, a kind of entry, a section of a briefing. */
export function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-xs leading-4 font-medium text-muted-foreground", className)}>{children}</p>;
}

/** A passage from the book, set in the book's face, with a rule in its highlight colour. */
export function Quote({ text, color, onClick, className }: { text: string; color?: string; onClick?: () => void; className?: string }) {
  const cls = cn(
    "block w-full border-l-2 pl-3 text-left font-book text-base leading-relaxed text-foreground/90",
    !color && "border-border",
    className,
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title="Go to passage"
      style={{ borderColor: color }}
      className={cn(
        cls,
        "cursor-pointer rounded-r-sm transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
      )}
    >
      {text}
    </button>
  ) : (
    <blockquote style={{ borderColor: color }} className={cls}>
      {text}
    </blockquote>
  );
}

/** Placeholder lines while something loads or the AI writes. */
export function Loading({ label = "Loading…", lines = 3, className }: { label?: string; lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" role="status">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-3 rounded-sm bg-muted motion-safe:animate-pulse" style={{ width: `${[94, 82, 64, 88][i % 4]}%` }} />
        ))}
      </div>
    </div>
  );
}

/** What went wrong, and a way to try again. */
export function Failed({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2", className)} role="alert">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Btn size="sm" tone="quiet" icon={<RotateCcw />} onClick={onRetry}>
          Try again
        </Btn>
      )}
    </div>
  );
}

/** A panel with nothing in it yet: one line saying so, and optionally how to fill it. */
export function Empty({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("pt-2", className)}>
      <p className="text-base font-medium">{title}</p>
      {children && <div className="mt-3 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A row with a 16px icon centred on the first line of its text. */
export function IconLine({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("flex gap-3 text-sm leading-5", className)}>
      <span className="flex h-5 shrink-0 items-center">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** A bulleted line whose dot sits on the middle of the first line, at any text size. */
export function Bullet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <li className={cn("flex gap-3", className)}>
      <span aria-hidden className="flex h-lh shrink-0 items-center">
        <span className="size-1 rounded-full bg-muted-foreground/70" />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
