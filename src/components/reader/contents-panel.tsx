"use client";

import { cn } from "@/lib/utils";
import type { Entry } from "./config";
import { Sheet, SheetBody } from "./sheet";

export function ContentsPanel({
  toc,
  current,
  onPick,
  onClose,
}: {
  toc: Entry[];
  current: number;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Contents" variant="side" onClose={onClose}>
      <SheetBody>
        <nav aria-label="Chapters" className="-mx-3">
          {toc.map((t, i) => (
            <button
              key={`${t.href}-${i}`}
              type="button"
              aria-current={i === current ? "true" : undefined}
              ref={i === current ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
              onClick={() => onPick(i)}
              // Rows reach 8px past the text on each side for the hover; the text lines up with the title.
              style={{ paddingLeft: `${0.75 + t.depth}rem` }}
              className={cn(
                "flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg py-2 pr-3 text-left text-sm leading-5 transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-12",
                i === current ? "bg-muted font-medium text-foreground" : "text-foreground/80",
              )}
            >
              <span className="min-w-0 flex-1">{t.label}</span>
            </button>
          ))}
        </nav>
      </SheetBody>
    </Sheet>
  );
}
