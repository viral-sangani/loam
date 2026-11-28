"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Check, ChevronDown, Copy, Download } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { Btn, Chip, IconBtn, field } from "./kit";
import { DeleteButton, useJump } from "./panel-bits";
import { Empty, Failed, Loading, Quote, SectionLabel, Sheet, SheetBody, SheetFooter } from "./sheet";
import { SWATCH, markColor } from "./use-marks";

type Filter = "all" | NotebookEntry["kind"];
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["mark", "Highlights"],
  ["ask", "Questions"],
  ["term", "Terms"],
];
const NONE_YET: Record<Exclude<Filter, "all">, string> = { mark: "No highlights yet.", ask: "No questions yet.", term: "No terms yet." };

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
  // "All" shows no count: it is the sum of the others, and four counted pills don't fit across the panel.
  const counts: Record<Exclude<Filter, "all">, number> = {
    mark: data?.marks.length ?? 0,
    ask: data?.asks.length ?? 0,
    term: data?.lookups.length ?? 0,
  };

  return (
    <Sheet title="Notebook" variant="side" onClose={onClose}>
      {data && entries.length > 0 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-4 pointer-coarse:gap-2" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <Chip key={f} pressed={filter === f} count={f === "all" ? undefined : counts[f]} onClick={() => setFilter(f)}>
              {label}
            </Chip>
          ))}
        </div>
      )}

      <SheetBody className="pt-0">
        {!data && <Loading className="pt-1" />}
        {data && entries.length === 0 && (
          <Empty title="Nothing here yet">Highlights, notes, questions and terms you look up in this book appear here.</Empty>
        )}
        {data && filter !== "all" && entries.length > 0 && shown.length === 0 && (
          <p className="pt-2 text-sm text-muted-foreground">{NONE_YET[filter]}</p>
        )}
        {shown.map((e, i) => {
          const chapter = chapterLabel(toc, e.pos.section);
          const newChapter = i === 0 || chapterLabel(toc, shown[i - 1].pos.section) !== chapter;
          return (
            <div key={e.key}>
              {newChapter && (
                <h3 className={cn("border-b border-border pb-2 text-sm leading-5 font-semibold", i > 0 ? "pt-8" : "pt-2")}>{chapter}</h3>
              )}
              <div className={cn("py-4", !newChapter && "border-t border-border")}>
                {e.kind === "mark" && <MarkEntry mark={e.mark} onJump={jump} />}
                {e.kind === "ask" && <AskEntry ask={e.ask} pos={e.pos} onJump={jump} />}
                {e.kind === "term" && <TermEntry lookup={e.lookup} onJump={jump} />}
              </div>
            </div>
          );
        })}
      </SheetBody>

      {data && entries.length > 0 && <ExportBar markdown={() => notebookMarkdown(data, toc)} fileName={notebookFileName(data.title)} />}
    </Sheet>
  );
}

/** The kind of entry on the left, and its actions (go to the passage, delete) on the right. */
function EntryHead({ kind, onGo, children }: { kind: string; onGo: () => void; children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex h-8 items-center justify-between gap-2 pointer-coarse:h-11">
      <SectionLabel>{kind}</SectionLabel>
      <div className="-mr-2 flex items-center gap-1 pointer-coarse:gap-2">
        <IconBtn size="sm" label="Go to passage" onClick={onGo}>
          <ArrowUpRight />
        </IconBtn>
        {children}
      </div>
    </div>
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
      <Quote text={mark.quote} color={swatch(mark.color)} onClick={go} />
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
        placeholder="Add a note"
        aria-label="Note"
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => flush.current(), 800);
        }}
        onBlur={() => flush.current()}
        // Reads as plain text until pointed at; the text lines up with the quote above.
        className={cn(field, "-mx-3 field-sizing-content block max-h-48 min-h-9 w-[calc(100%+1.5rem)] resize-none border-transparent bg-transparent py-2 leading-5 hover:border-border")}
      />
      <span
        aria-live="polite"
        className={cn("pointer-events-none absolute right-2.5 bottom-2 text-xs text-muted-foreground transition-opacity duration-200", saved ? "opacity-100" : "opacity-0")}
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
      <EntryHead kind="Question" onGo={go}>
        <DeleteButton label="Delete question" onDelete={() => void remove({ askId: ask._id })} />
      </EntryHead>
      {ask.quote && (
        <div className="mb-3">
          <Quote text={ask.quote} onClick={go} className="text-sm text-muted-foreground" />
        </div>
      )}
      <p className="text-base leading-snug font-medium">{ask.question}</p>
      <div className="mt-2">
        {ask.status === "pending" && <Loading label="Answering…" />}
        {ask.status === "error" && <Failed message="Couldn't get an answer." onRetry={() => void retry({ askId: ask._id })} />}
        {ask.status === "ready" && ask.answer && (
          <>
            {open ? (
              <Answer text={ask.answer} onCite={onJump} />
            ) : (
              <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{answerGist(ask.answer)}</p>
            )}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="-ml-1 mt-1 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:h-11 [&_svg]:size-4"
            >
              {open ? "Show less" : "Show full answer"}
              <ChevronDown className={cn("transition-transform duration-200", open && "rotate-180")} />
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
      <button
        type="button"
        onClick={go}
        className="block cursor-pointer rounded-sm text-left text-base leading-snug font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {lookup.title}
      </button>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{lookup.summary}</p>
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
    <SheetFooter>
      <Btn icon={copied ? <Check /> : <Copy />} onClick={copy}>
        {copied ? "Copied" : "Copy as Markdown"}
      </Btn>
      <Btn tone="ghost" icon={<Download />} onClick={download}>
        Download .md
      </Btn>
    </SheetFooter>
  );
}
