# Loam

A quiet, immersive place to read. Add an EPUB and its audiobook; Loam highlights each word as it is
narrated, and underlines terms worth a closer look. Tap one for a quick briefing (summary, picture,
one-liners, what it means in this passage, a video and a Wikipedia link) in a side panel.

## How it works

- **Next.js app** (`src/`): shelf, sign-in, and the reader (epub.js). Highlights are painted with the
  CSS Custom Highlight API, so the book's markup never changes.
- **Convex** (`convex/`): accounts (username + password via Convex Auth), books, files, reading
  progress, word timings, terms and briefings. Syncs across devices.
- **Term finding** (`convex/terms.ts`): after upload, a background job sends the text, chapter by
  chapter, to a cheap model (GPT-6 Luna by default) to pick terms worth explaining.
- **Briefings** (`convex/briefs.ts`): built on first tap and cached. Wikipedia supplies the summary,
  image and link; the model writes the one-liners and the passage context.
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
npx convex env set YOUTUBE_API_KEY <key>          # embed videos; without it the panel links to a YouTube search
```

## Run

```bash
npm run dev       # the app, on http://localhost:3000
npm run convex    # watch and push Convex functions while developing
npm run aligner   # times audiobooks against their books (needs: brew install ffmpeg whisper-cpp)
```

The aligner downloads the whisper `base.en` model (~150 MB) on first run and processes about
45× faster than real time on Apple Silicon (a 10-hour audiobook in ~15 minutes).

## Reader shortcuts

`← →` / `Space` pages · `[ ]` chapters · `C` contents · `A` audiobook · `K` play/pause · `−` `=` text
size · `N` parchment/night · `P` progress · `?` all shortcuts
