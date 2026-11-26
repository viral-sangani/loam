"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Check, ChevronDown, Copy, Download, Highlighter, MessageCircleQuestionMark, MousePointerClick } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { Pos } from "@/lib/anchors";
import {
  chapterLabel,
  notebookEntries,
  notebookFileName,
  notebookMarkdown,
  type NotebookAsk,
  type NotebookEntry,
  type NotebookLookup,
  type NotebookMark,
  type TocItem,
} from "@/lib/notebook-export";
import { cn } from "@/lib/utils";
import { Answer, answerGist } from "./answer";
import { DeleteButton, Label, useJump } from "./panel-bits";
import { Sheet } from "./sheet";
import { SWATCH, markColor } from "./use-marks";

type Filter = "all" | NotebookEntry["kind"];
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["mark", "Highlights"],
  ["ask", "Questions"],
  ["term", "Terms"],
];

/** A highlight's colour, for the thin rule beside its quote. */
const swatch = (c: string | null) => SWATCH[markColor(c)];

/** Everything marked, asked and looked up in this book, in reading order. */
export function NotebookPanel({
  bookId,
  toc,
  onJump,
  onClose,
}: {
  bookId: Id<"books">;
  /** The book's contents, for chapter names; without it, groups are numbered by section. */
  toc?: readonly TocItem[];
  onJump: (pos: Pos) => void;
  onClose: () => void;
}) {
  const data = useQuery(api.notebook.get, { bookId });
  const jump = useJump(onJump, onClose);
  const [filter, setFilter] = useState<Filter>("all");
  const entries = useMemo(() => (data ? notebookEntries(data) : []), [data]);
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const counts: Record<Filter, number> = {
    all: entries.length,
    mark: data?.marks.length ?? 0,
    ask: data?.asks.length ?? 0,
    term: data?.lookups.length ?? 0,
  };

  return (
    <Sheet title="Notebook" variant="side" onClose={onClose}>
      {data && entries.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-5 pb-3" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors pointer-coarse:py-2",
                filter === f ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {label} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
        {!data && (
          <div className="space-y-4 pt-1" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}
        {data && entries.length === 0 && <EmptyNotebook />}
        {data && entries.length > 0 && shown.length === 0 && (
          <p className="pt-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {shown.map((e, i) => {
          const chapter = chapterLabel(toc, e.pos.section);
          const newChapter = i === 0 || chapterLabel(toc, shown[i - 1].pos.section) !== chapter;
          return (
            <div key={e.key}>
              {newChapter && <Label className={cn("pb-2 font-serif text-xs normal-case italic", i > 0 && "pt-5")}>{chapter}</Label>}
              <div className={cn("py-3.5", !newChapter && "border-t border-border/60")}>
                {e.kind === "mark" && <MarkEntry mark={e.mark} onJump={jump} />}
                {e.kind === "ask" && <AskEntry ask={e.ask} pos={e.pos} onJump={jump} />}
                {e.kind === "term" && <TermEntry lookup={e.lookup} onJump={jump} />}
              </div>
            </div>
          );
        })}
      </div>

      {data && entries.length > 0 && <ExportBar markdown={() => notebookMarkdown(data, toc)} fileName={notebookFileName(data.title)} />}
    </Sheet>
  );
}

function EmptyNotebook() {
  const tips: [typeof Highlighter, string][] = [
    [Highlighter, "Select a passage to highlight it, add a note, or ask what it means."],
    [MousePointerClick, "Tap an underlined word to learn more about it."],
    [MessageCircleQuestionMark, "Ask about the book so far from the question button up top."],
  ];
  return (
    <div className="pt-4">
      <p className="font-serif text-[15px] leading-relaxed">Your notebook fills in as you read.</p>
      <ul className="mt-4 space-y-3">
        {tips.map(([Icon, text]) => (
          <li key={text} className="flex gap-3 text-sm text-muted-foreground">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary/80" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-muted-foreground">It all lands here in reading order, ready to copy into your notes app.</p>
    </div>
  );
}

/** The kind of entry on the left, and its actions (go to the passage, delete) on the right. */
function EntryHead({ kind, onGo, children }: { kind: string; onGo: () => void; children?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <Label>{kind}</Label>
      <div className="-my-1 flex items-center">
        <button
          type="button"
          aria-label="Go to passage"
          title="Go to passage"
          onClick={onGo}
          className="inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:px-3"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** A quote from the book, with a thin rule in its highlight colour. Pressing it goes there. */
function Quote({ text, color, onGo }: { text: string; color?: string; onGo: () => void }) {
  return (
    <button
      type="button"
      onClick={onGo}
      style={{ borderColor: color }}
      className={cn(
        "block w-full border-l-2 pl-3 text-left font-serif text-[15px] leading-relaxed transition-colors hover:text-foreground",
        color ? "text-foreground/90" : "border-border text-sm text-muted-foreground",
      )}
    >
      {text}
    </button>
  );
}

function MarkEntry({ mark, onJump }: { mark: NotebookMark; onJump: (pos: Pos) => void }) {
  const remove = useMutation(api.marks.remove);
  const go = () => onJump({ section: mark.anchor.section, para: mark.anchor.startPara });
  return (
    <>
      <EntryHead kind="Highlight" onGo={go}>
        <DeleteButton label="Delete highlight" onDelete={() => void remove({ markId: mark._id })} />
      </EntryHead>
      <Quote text={mark.quote} color={swatch(mark.color)} onGo={go} />
      <NoteEditor markId={mark._id} initial={mark.note ?? ""} />
    </>
  );
}

/** A highlight's note, saved as you type (after a pause) and when you leave the field. */
function NoteEditor({ markId, initial }: { markId: Id<"marks">; initial: string }) {
  const update = useMutation(api.marks.update);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const last = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useRef(() => {});
  useEffect(() => {
    const save = () => {
      clearTimeout(timer.current);
      const note = pending.current;
      pending.current = null;
      if (note === null || note.trim() === last.current.trim()) return;
      last.current = note;
      void update({ markId, note })
        .then(() => setSaved(true))
        .catch(() => {});
    };
    flush.current = save;
    // Closing the panel mid-sentence still saves it.
    return save;
  }, [update, markId]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <div className="relative mt-2">
      <textarea
        value={text}
        rows={1}
        placeholder="Add a note…"
        aria-label="Note"
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => flush.current(), 800);
        }}
        onBlur={() => flush.current()}
        className="field-sizing-content block max-h-48 min-h-8 w-full resize-none rounded-lg bg-transparent px-2 py-1.5 -mx-2 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:bg-secondary/70 focus:outline-none"
      />
      <span
        aria-live="polite"
        className={cn("pointer-events-none absolute right-0 -bottom-4 text-[11px] text-muted-foreground transition-opacity", saved ? "opacity-100" : "opacity-0")}
      >
        {saved && "Saved"}
      </span>
    </div>
  );
}

function AskEntry({ ask, pos, onJump }: { ask: NotebookAsk; pos: Pos; onJump: (pos: Pos) => void }) {
  const remove = useMutation(api.asks.remove);
  const retry = useMutation(api.asks.retry);
  const [open, setOpen] = useState(false);
  const go = () => onJump(pos);
  return (
    <>
      <EntryHead kind={ask.kind === "book" ? "Question so far" : "Question"} onGo={go}>
        <DeleteButton label="Delete question" onDelete={() => void remove({ askId: ask._id })} />
      </EntryHead>
      {ask.quote && (
        <div className="mb-2">
          <Quote text={ask.quote} onGo={go} />
        </div>
      )}
      <p className="text-[15px] font-medium leading-snug">{ask.question}</p>
      <div className="mt-1.5">
        {ask.status === "pending" && <p className="animate-pulse font-serif text-sm text-muted-foreground italic">Thinking…</p>}
        {ask.status === "error" && (
          <p className="text-sm text-destructive">
            Couldn&apos;t get an answer.{" "}
            <button type="button" className="text-primary underline underline-offset-4" onClick={() => void retry({ askId: ask._id })}>
              Retry
            </button>
          </p>
        )}
        {ask.status === "ready" && ask.answer && (
          <>
            {open ? (
              <Answer text={ask.answer} onCite={onJump} className="text-sm" />
            ) : (
              <p className="line-clamp-2 text-sm text-muted-foreground">{answerGist(ask.answer)}</p>
            )}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary pointer-coarse:py-2"
            >
              {open ? "Less" : "Full answer"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
          </>
        )}
      </div>
    </>
  );
}

function TermEntry({ lookup, onJump }: { lookup: NotebookLookup; onJump: (pos: Pos) => void }) {
  const go = () => onJump({ section: lookup.section, para: lookup.para });
  return (
    <>
      <EntryHead kind="Term" onGo={go} />
      <button type="button" onClick={go} className="block text-left font-serif text-[15px] font-medium hover:text-primary">
        {lookup.title}
      </button>
      <p className="mt-1 text-sm leading-relaxed text-foreground/85">{lookup.summary}</p>
    </>
  );
}

/** Copy or download the notebook as Markdown. */
function ExportBar({ markdown, fileName }: { markdown: () => string; fileName: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () =>
    void navigator.clipboard
      .writeText(markdown())
      .then(() => setCopied(true))
      .catch(() => {});
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
      <Button variant="secondary" size="sm" className="pointer-coarse:h-11 pointer-coarse:px-4" onClick={copy}>
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy as Markdown"}
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-4" onClick={download}>
        <Download /> Download .md
      </Button>
    </div>
  );
}
