# Loam

An EPUB reader with audiobook sync and an AI reading companion.

Add an EPUB and its audiobook. Loam highlights each word as it is narrated and underlines terms
worth a closer look. Tap one for a short briefing: a summary, a picture, what it refers to in this
passage, and a video or Wikipedia link when there is one.

## How it works

- **Next.js app** (`src/`): owner sign-in, the public library (a 3D reading room built with three.js, or a plain list on phones and by choice), and the reader (epub.js).
  Highlights are painted with the CSS Custom Highlight API, so the book's markup never changes.
- **Convex** (`convex/`): the owner account (username + password via Convex Auth), books, files, reading
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

## Sharing

Sign in at `/admin`. Add an EPUB and optionally attach its audiobook. In the room, select the
book and choose **More actions → Share with readers**. In List view, open the book’s details for
the same control. Anyone with the library or reader link can read and play the audio for shared
books. Readers save their place on their device. The owner account has synced progress, notes,
audiobook text sync and the reading companion.

Books start private. **Make private** removes the book from the public library and disables its
reader link after the CDN cache expires (up to 60 seconds).

### Configuration and usage limits

- Set `LOAM_OWNER_ID` on Convex to the existing owner's document ID in `users`. For a new
  deployment, run the internal `auth:createOwner` mutation from the Convex console and set the
  variable to the returned ID. The public app has no signup flow.
- Generate a random `LOAM_PUBLIC_KEY` and set the same value on Convex and in the Vercel production
  environment. For local development, also put it in `.env.local`. Keep it server-side.
- The anonymous API reserves up to 90 origin requests per minute, 700 per UTC day and 6,000 per UTC
  month. Public file transfer from Convex is capped at 512 MiB per UTC day and 768 MiB per UTC month.
  Responses that exceed a limit return HTTP 429. Guest reads use short CDN caching, and audio
  streams through the same gateway with byte-range support.
- A Vercel Firewall rule for `/api/library/` can enforce an additional per-IP limit. The
  application quotas cover successful origin work. Hosting requests and other provider usage
  still count toward the account’s plan limits.

## Reader shortcuts

`← →` / `Space` pages · `[ ]` chapters · `C` contents · `M` notebook · `Q` ask · `R` recap ·
`A` audiobook · `K` play/pause · `−` `=` text size · `N` next theme · `P` progress · `?` keyboard shortcuts
