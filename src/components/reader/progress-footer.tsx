"use client";

export function ProgressFooter({
  chapter,
  pagesLeft,
  percent,
}: {
  chapter: string | null;
  pagesLeft: number | null;
  percent: number | null;
}) {
  const left =
    pagesLeft === null
      ? null
      : pagesLeft === 0
        ? { short: "Last page", long: "Last page in chapter" }
        : { short: `${pagesLeft} left`, long: `${pagesLeft} ${pagesLeft === 1 ? "page" : "pages"} left in chapter` };

  return (
    <footer
      className="absolute inset-x-0 bottom-0 z-20 pr-[max(1.25rem,6vw,calc(env(safe-area-inset-right)+0.75rem))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,6vw,calc(env(safe-area-inset-left)+0.75rem))] short:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      aria-label="Reading progress"
    >
      <div className="mb-2 flex items-baseline short:mb-1.5 justify-between gap-4 text-xs leading-4 text-muted-foreground">
        <span className="truncate" data-testid="chapter">
          {chapter}
        </span>
        <span className="shrink-0 tabular-nums">
          {left && (
            <>
              <span className="sm:hidden">{left.short}</span>
              <span className="hidden sm:inline">{left.long}</span>
            </>
          )}
          {left && percent != null && <span className="mx-2" aria-hidden>·</span>}
          {percent != null && <span>{Math.round(percent * 100)}%</span>}
        </span>
      </div>
      <div className="h-px bg-border">
        <div className="h-px bg-muted-foreground transition-[width] duration-300" style={{ width: `${(percent ?? 0) * 100}%` }} />
      </div>
    </footer>
  );
}
