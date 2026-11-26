#!/usr/bin/env node
/**
 * Loam aligner: times every word of a book against its audiobook, on this machine, for free.
 *
 *   npm run aligner          # keeps watching for new audiobooks
 *   npm run aligner -- --once
 *
 * Needs ffmpeg and whisper.cpp (`brew install ffmpeg whisper-cpp`). Downloads the whisper
 * base.en model (~150 MB) on first run. Reads NEXT_PUBLIC_CONVEX_URL and WORKER_SECRET from .env.local.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { align, tokenize } from "./align.mjs";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.WORKER_SECRET;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_CONVEX_URL and WORKER_SECRET (they live in .env.local).");
  process.exit(1);
}
const MODEL_DIR = path.join(os.homedir(), ".cache", "loam-whisper");
const MODEL = process.env.WHISPER_MODEL ?? path.join(MODEL_DIR, "ggml-base.en.bin");
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER = process.env.WHISPER_BIN ?? "whisper-cli";
const POLL_MS = 15_000;

const client = new ConvexHttpClient(url);
const api = anyApi;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function run(cmd, args, onStderr) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      err += d;
      onStderr?.(String(d));
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
  });
}

async function download(from, to) {
  const res = await fetch(from);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(to));
}

async function ensureModel() {
  if (existsSync(MODEL)) return;
  mkdirSync(path.dirname(MODEL), { recursive: true });
  log("Downloading whisper model (~150 MB)…");
  await download(MODEL_URL, `${MODEL}.part`);
  await rename(`${MODEL}.part`, MODEL);
}

const durationMs = async (file) =>
  Math.round(
    Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])) * 1000,
  );

async function processBook(bookId, title) {
  const update = (patch) => client.mutation(api.worker.update, { secret, bookId, ...patch });
  const dir = await mkdtemp(path.join(os.tmpdir(), "loam-align-"));
  try {
    log(`Aligning "${title}"`);
    await update({ status: "aligning", progress: 0.01, stage: "Downloading audio" });
    const job = await client.query(api.worker.job, { secret, bookId });
    if (!job) return;

    const inputs = [];
    for (const [i, f] of job.files.entries()) {
      const to = path.join(dir, `in-${i}${path.extname(f.name) || ".audio"}`);
      await download(f.url, to);
      inputs.push(to);
    }
    const durationsMs = await Promise.all(inputs.map(durationMs));

    // One 16 kHz mono WAV for the whole book, which is what whisper wants.
    await update({ progress: 0.04, stage: "Preparing audio" });
    const wav = path.join(dir, "book.wav");
    const ins = inputs.flatMap((f) => ["-i", f]);
    const filter = inputs.length > 1 ? ["-filter_complex", `${inputs.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1`] : [];
    await run("ffmpeg", ["-y", "-v", "error", ...ins, ...filter, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

    // Word-level timestamps: one word per segment.
    await update({ progress: 0.05, stage: "Listening" });
    let lastReport = 0;
    const threads = String(Math.min(8, os.cpus().length));
    await run(
      WHISPER,
      ["-m", MODEL, "-f", wav, "-l", "en", "-t", threads, "-ml", "1", "-sow", "-oj", "-of", path.join(dir, "words"), "-pp"],
      (chunk) => {
        const m = [...chunk.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
        const now = Date.now();
        if (m && now - lastReport > 5000) {
          lastReport = now;
          void update({ progress: 0.05 + (Number(m[1]) / 100) * 0.85 }).catch(() => {});
        }
      },
    );
    const result = JSON.parse(await readFile(path.join(dir, "words.json"), "utf8"));
    const spoken = [];
    for (const seg of result.transcription ?? []) {
      const words = tokenize(seg.text ?? "");
      const from = seg.offsets?.from ?? 0;
      const to = seg.offsets?.to ?? from;
      words.forEach((w, k) => spoken.push({ w, start: Math.round(from + ((to - from) * k) / words.length) }));
    }
    log(`Heard ${spoken.length} words`);

    await update({ progress: 0.92, stage: "Matching words to the text" });
    const { coverage, sections } = align(job.sections, spoken);
    // Upload in batches that stay well under Convex's argument size limit.
    let batch = [];
    let size = 0;
    for (const s of sections) {
      batch.push(s);
      size += s.starts.length;
      if (size > 40_000) {
        await client.mutation(api.worker.saveTimings, { secret, bookId, sections: batch });
        batch = [];
        size = 0;
      }
    }
    if (batch.length) await client.mutation(api.worker.saveTimings, { secret, bookId, sections: batch });
    await update({ status: "ready", progress: 1, stage: "Synced", coverage, durationsMs });
    log(`Done: ${Math.round(coverage * 100)}% of the book's words matched the audio`);
  } catch (e) {
    console.error(e);
    await update({ status: "error", stage: "Failed", error: String(e.message ?? e).slice(0, 500) }).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await ensureModel();
  const once = process.argv.includes("--once");
  log("Aligner watching for audiobooks…");
  for (;;) {
    try {
      const jobs = await client.query(api.worker.pending, { secret });
      for (const j of jobs) await processBook(j.bookId, j.title);
    } catch (e) {
      console.error("Poll failed:", e.message ?? e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

await main();
