# Loam

An EPUB reader with audiobook sync and an AI reading companion.

Add an EPUB and its audiobook. Loam highlights each word as it is narrated and underlines terms
worth a closer look. Tap one for a short briefing: a summary, a picture, what it refers to in this
passage, and a video or Wikipedia link when there is one.

## How it works

- **Next.js app** (`src/`): sign-in, the library (a list of your books), and the reader (epub.js).
  Highlights are painted with the CSS Custom Highlight API, so the book's markup never changes.
- **Convex** (`convex/`): accounts (username + password via Convex Auth), books, files, reading
  progress, word timings, terms and briefings. Syncs across devices.
- **Term finding** (`convex/terms.ts`): after upload, a background job sends the text, chapter by
  chapter, to a cheap model (GPT-6 Luna by default) to pick terms worth explaining.
- **Briefings** (`convex/briefs.ts`): built on first tap and cached. Wikipedia supplies the summary,
  image and link; the model writes the passage context.
- **Reading companion** (`convex/asks.ts`, `recaps.ts`, `marks.ts`, `review.ts`, `notebook.ts`).
  Answers only see the text up to where you are (no spoilers) and cite paragraphs you can jump to.
  - Select a passage to highlight it, add a note, or ask about it (Explain, Define, Simplify, or your own question).
  - **Ask**: questions about the book so far.
  - **Recap**: a recap up to where you are, offered when you come back to a book.
  - **Notebook**: everything you highlight, ask and look up, in reading order. Exports to Markdown.
  - **Daily review**: highlights and terms come back in the library, spaced out like flashcards.
  - **Reading map**: the whole book along the right edge, with your highlights.
- **Aligner** (`worker/`): runs on your machine. It transcribes the audiobook with whisper.cpp
  (free, local) and matches the spoken words to the book's words, giving every word a start time.

The upload parser, the reader and the aligner all split text the same way
(`src/lib/book-text.ts`, `worker/align.mjs`), so a (chapter, paragraph, word) position means the same thing everywhere.

## Setup

```bash
npm install
npx convex dev --once        # creates/links a Convex deployment and writes .env.local
npx convex env set DEHOLD_API_KEY <key>          # model gateway key
npx convex env set WORKER_SECRET <random string> # shared with the aligner
echo "WORKER_SECRET=<same random string>" >> .env.local
# optional
npx convex env set LLM_MODEL gpt-6-luna           # default
npx convex env set YOUTUBE_API_KEY <key>          # embed a video in briefings
```

## Run

```bash
npm run dev       # the app, on http://localhost:3000
npm run convex    # watch and push Convex functions while developing
npm run aligner   # times audiobooks against their books (needs: brew install ffmpeg whisper-cpp)
```

The aligner downloads the whisper `base.en` model (~150 MB) on first run and processes about
45× faster than real time on Apple Silicon (a 10-hour audiobook in ~15 minutes).

## Deploy

Live at https://books.viralsangani.me. Vercel builds every push to `master` on the fork with
`npx convex deploy --cmd 'npm run build'` (see `vercel.json`), which pushes the Convex functions to
the production deployment and builds the app against it. Vercel needs `CONVEX_DEPLOY_KEY` (a prod
deploy key). The aligner still runs on your machine; set `ALIGNER_CONVEX_URL` in `.env.local` to the
prod Convex URL so it serves the live site.

## Reader shortcuts

`← →` / `Space` pages · `[ ]` chapters · `C` contents · `M` notebook · `Q` ask · `R` recap ·
`A` audiobook · `K` play/pause · `−` `=` text size · `N` next theme · `P` progress · `?` keyboard shortcuts
