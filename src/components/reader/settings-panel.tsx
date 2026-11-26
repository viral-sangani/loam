"use client";

import { Minus, Plus } from "lucide-react";
import { READER_THEMES, type ReaderPrefs } from "@/lib/library";
import { cn } from "@/lib/utils";
import { FONT_STEPS, LINE_STEPS, THEME_NAMES, step } from "./config";
import { IconBtn, Segmented } from "./kit";
import { Sheet } from "./sheet";

const THEMES = READER_THEMES.map((t) => [t, THEME_NAMES[t]] as const);

export function SettingsPanel({
  prefs,
  onChange,
  onClose,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  onClose: () => void;
}) {
  const fontAt = FONT_STEPS.indexOf(prefs.fontSize);
  const lineAt = LINE_STEPS.indexOf(prefs.lineHeight);
  return (
    <Sheet title="Text and theme" variant="popover" onClose={onClose}>
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 pt-1 pb-6 sm:p-5 short:p-5">
        <Segmented label="Theme" options={THEMES} value={prefs.theme} onChange={(theme) => onChange({ theme })} />
        <div className="space-y-1">
          <Row label="Text size">
            <IconBtn label="Smaller text" disabled={fontAt === 0} onClick={() => onChange({ fontSize: step(FONT_STEPS, prefs.fontSize, -1) })}>
              <Minus />
            </IconBtn>
            <Value>{prefs.fontSize}%</Value>
            <IconBtn label="Larger text" disabled={fontAt === FONT_STEPS.length - 1} onClick={() => onChange({ fontSize: step(FONT_STEPS, prefs.fontSize, 1) })}>
              <Plus />
            </IconBtn>
          </Row>
          <Row label="Line spacing">
            <IconBtn label="Tighter lines" disabled={lineAt === 0} onClick={() => onChange({ lineHeight: step(LINE_STEPS, prefs.lineHeight, -1) })}>
              <Minus />
            </IconBtn>
            <Value>{prefs.lineHeight.toFixed(2)}</Value>
            <IconBtn label="Looser lines" disabled={lineAt === LINE_STEPS.length - 1} onClick={() => onChange({ lineHeight: step(LINE_STEPS, prefs.lineHeight, 1) })}>
              <Plus />
            </IconBtn>
          </Row>
          <Row label="Progress bar">
            <button
              type="button"
              role="switch"
              aria-checked={prefs.showProgress}
              aria-label="Show progress bar"
              onClick={() => onChange({ showProgress: !prefs.showProgress })}
              className="group flex h-9 cursor-pointer items-center rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:h-11"
            >
              <span className={cn("relative h-5 w-9 rounded-full transition-colors duration-150", prefs.showProgress ? "bg-primary" : "bg-input")}>
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-xs transition-transform duration-150",
                    prefs.showProgress && "translate-x-4",
                  )}
                />
              </span>
            </button>
          </Row>
        </div>
      </div>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <div className="-mr-1.5 flex items-center gap-1 pointer-coarse:gap-2">{children}</div>
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">{children}</span>;
}
