"use client";

import { Fragment, type ReactNode } from "react";
import { CITATION, type Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";

/**
 * A small Markdown subset for AI answers: paragraphs, "- " lists, **bold**, *italic*, `code`,
 * paragraph citations ([¶12.4]) as chips that jump to the passage, and the ==key answer==,
 * which the model marks once so a skimmer can stop there. Re-parsing on each render is cheap.
 */
export function Answer({ text, onCite, className }: { text: string; onCite?: (pos: Pos) => void; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={cn("space-y-2.5 text-[15px] leading-relaxed", className)}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-2.5 size-1 shrink-0 rounded-full bg-primary/70" />
                  <span>{inline(l.replace(/^\s*[-*•]\s+/, ""), onCite)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, onCite)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** The answer as plain text, for copying and exporting: no key-answer marks, citations kept. */
export const plainAnswer = (text: string) => text.replace(/==(.+?)==/g, "$1");

/** One line that stands for the whole answer: the marked key answer, or else the first sentence. */
export function answerGist(text: string) {
  const key = /==(.+?)==/.exec(text)?.[1];
  const s = key ?? text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.replace(CITATION, "").replace(/[*_`=]/g, "").replace(/\s+/g, " ").trim();
}

const TOKEN = /(==.+?==|\*\*.+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`|\[¶\d+\.\d+(?:[-–]\d+)?\])/g;

function inline(s: string, onCite?: (pos: Pos) => void): ReactNode[] {
  return s.split(TOKEN).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("==") && part.endsWith("==") && part.length > 4)
      return (
        <mark key={i} className="rounded-sm bg-[oklch(0.9_0.09_95/0.55)] px-0.5 text-inherit dark:bg-[oklch(0.5_0.08_95/0.45)]">
          {inline(part.slice(2, -2), onCite)}
        </mark>
      );
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{inline(part.slice(2, -2), onCite)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    const cite = new RegExp(CITATION.source).exec(part);
    if (cite && cite[0] === part) {
      const pos = { section: Number(cite[1]), para: Number(cite[2]) };
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCite?.(pos)}
          disabled={!onCite}
          title="Go to this passage"
          className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-full bg-secondary px-1.5 align-middle text-[11px] font-medium text-secondary-foreground tabular-nums transition-colors hover:bg-primary hover:text-primary-foreground disabled:pointer-events-none"
        >
          ¶{cite[2]}
          {cite[3] ? `–${cite[3]}` : ""}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
