"use client";

import { SHORTCUTS } from "./config";
import { SheetHeader } from "./sheet";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex animate-in items-center justify-center bg-scrim p-4 duration-200 fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-lg shadow-black/8"
        onClick={(e) => e.stopPropagation()}
      >
        <SheetHeader title="Keyboard shortcuts" onClose={onClose} />
        <dl className="overflow-y-auto px-5 pb-5">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex min-h-9 items-center justify-between gap-6 border-t border-border py-1.5 text-sm first:border-t-0">
              <dt>{d}</dt>
              <dd className="flex shrink-0 gap-1">
                {k.split(/\s{2,}/).map((key) => (
                  <kbd key={key} className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border px-1.5 font-mono text-xs text-muted-foreground">
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
