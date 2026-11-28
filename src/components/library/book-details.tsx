import { useState } from "react";
import { Btn } from "@/components/reader/kit";
import { audioLabel, pct, type AudioState, type Extras, type ListedBook, type PreviewPara } from "./model";
import { useExtras, usePreview } from "./use-book-details";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 highlights · 3 notes · 2 questions · recap ready", or null when there is nothing yet. */
function activity(x: Extras) {
  const parts = [
    x.highlights ? count(x.highlights, "highlight", "highlights") : null,
    x.notes ? count(x.notes, "note", "notes") : null,
    x.questions ? count(x.questions, "question", "questions") : null,
    x.lookedUp ? count(x.lookedUp, "term looked up", "terms looked up") : null,
    x.recap ? "recap ready" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function BookDetails({
  book,
  audio,
  live,
  onAddAudio,
  onRemove,
}: {
  book: ListedBook;
  audio: AudioState;
  live: boolean;
  onAddAudio: () => void;
  onRemove: () => Promise<void>;
}) {
  const extras = useExtras(live ? book._id : null);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const terms = book.terms.status === "done" && extras ? count(extras.terms, "term marked", "terms marked") : null;
  const coverage = audio.kind === "ready" && audio.coverage !== null ? `${pct(audio.coverage)} of the text follows the audio` : null;
  const facts = [terms, audioLabel(audio), coverage].filter(Boolean).join(" · ");
  const done = extras && activity(extras);

  return (
    <div className="space-y-4">
      {book.description && <p className="max-w-[62ch] text-sm leading-relaxed text-foreground/85">{book.description}</p>}
      {(facts || done) && (
        <div className="space-y-1 text-sm text-muted-foreground">
          {facts && <p>{facts}</p>}
          {done && <p>{done.charAt(0).toUpperCase() + done.slice(1)}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-sm">Remove this book and its notes?</span>
            <Btn size="sm" className="text-destructive" onClick={() => void onRemove()}>
              Remove
            </Btn>
            <Btn size="sm" tone="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Btn>
          </>
        ) : (
          <>
            <Btn size="sm" aria-expanded={preview} onClick={() => setPreview((p) => !p)} disabled={!live}>
              {preview ? "Hide first pages" : "Read the first pages"}
            </Btn>
            <Btn size="sm" disabled={!live || audio.kind === "uploading"} onClick={onAddAudio}>
              {audio.kind === "uploading" ? `Uploading ${audio.pct}%` : audio.kind === "none" ? "Add audiobook" : "Replace audiobook"}
            </Btn>
            <Btn size="sm" tone="ghost" disabled={!live} onClick={() => setConfirm(true)}>
              Remove
            </Btn>
          </>
        )}
      </div>

      {preview && <FirstPages bookId={book._id} />}
    </div>
  );
}

function FirstPages({ bookId }: { bookId: string }) {
  const paras = usePreview(bookId);
  return (
    <div className="max-w-[62ch] rounded-lg border border-border px-5 py-5 sm:px-8 sm:py-7">
      {paras === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : paras.length === 0 ? (
        <p className="text-sm text-muted-foreground">No preview for this book.</p>
      ) : (
        <>
          <PreviewText paras={paras} />
          {paras.some((p) => p.marked.some(Boolean)) && <p className="mt-5 text-xs text-muted-foreground">Dotted words have an explanation in the reader.</p>}
        </>
      )}
    </div>
  );
}

/** Consecutive words joined into runs, so a several-word term is marked as one. */
function runs(p: PreviewPara) {
  const out: { text: string; marked: boolean }[] = [];
  p.words.forEach((w, i) => {
    const last = out[out.length - 1];
    if (last && last.marked === p.marked[i]) last.text += " " + w;
    else out.push({ text: w, marked: p.marked[i] });
  });
  return out;
}

/** The opening paragraphs; a short first paragraph is the chapter heading. */
function PreviewText({ paras }: { paras: PreviewPara[] }) {
  const heading = paras.length > 1 && paras[0].words.length <= 8 ? paras[0].words.join(" ") : null;
  const body = heading ? paras.slice(1) : paras;
  return (
    <div className="font-book text-base leading-[1.7] hyphens-auto">
      {heading && <p className="mb-5 text-center text-lg italic">{heading}</p>}
      {body.map((p, i) => (
        <p key={`${p.section}:${p.para}`} style={{ textIndent: i ? "1.5em" : 0 }}>
          {runs(p).map((r, j) => (
            <span key={j}>
              {j > 0 && " "}
              {r.marked ? <span className="underline decoration-muted-foreground decoration-dotted underline-offset-[3px]">{r.text}</span> : r.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
