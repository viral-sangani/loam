"use client";

import { Fragment, type ReactNode } from "react";
import { CITATION, type Pos } from "@/lib/anchors";
import { cn } from "@/lib/utils";
import { Bullet } from "./sheet";

/**
 * A small Markdown subset for AI answers: paragraphs, "- " lists, **bold**, *italic*, `code`,
 * paragraph citations ([¶12.4]) as superscript links to the passage, and the ==key answer==,
 * which the model marks once in longer answers. Re-parsing on each render is cheap.
 */
export function Answer({ text, onCite, className }: { text: string; onCite?: (pos: Pos) => void; className?: string }) {
  // Paragraphs are split on blank lines; within one, a run of "- " lines is a list and the rest
  // is text (so a "Who's who:" line straight above its list still gets real bullets).
  const runs = text
    .trim()
    .split(/\n{2,}/)
    .flatMap((block) => {
      const out: { list: boolean; lines: string[] }[] = [];
      for (const line of block.split("\n")) {
        const list = BULLET.test(line);
        const last = out[out.length - 1];
        if (last && last.list === list) last.lines.push(line);
        else out.push({ list, lines: [line] });
      }
      return out;
    });
  return (
    <div className={cn("space-y-3 text-base leading-relaxed", className)}>
      {runs.map((run, i) =>
        run.list ? (
          <ul key={i} className="space-y-2">
            {run.lines.map((l, j) => (
              <Bullet key={j}>{inline(l.replace(BULLET, ""), onCite)}</Bullet>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {run.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, onCite)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

const BULLET = /^\s*[-*•]\s+/;

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
        <mark key={i} className="box-decoration-clone rounded-xs bg-key-mark px-0.5 text-inherit">
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
          title="Go to passage"
          className="ml-px cursor-pointer align-super text-[0.7em] leading-none text-muted-foreground tabular-nums underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none"
        >
          ¶{cite[2]}
          {cite[3] ? `–${cite[3]}` : ""}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
