import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { FunctionArgs } from "convex/server";

type LibraryRequest = FunctionArgs<typeof api.publicLibrary.read>["request"];

function parse(path: string[], range: string): LibraryRequest | null {
  if (path.length === 1 && path[0] === "catalog") return { kind: "catalog" };
  const [id, action] = path;
  if (path.length !== 2 || !/^[a-z0-9]{32}$/.test(id)) return null;
  if (action === "book" || action === "preview") return { kind: action, id };
  if (action === "cover" || action === "epub") return { kind: "file", id, asset: action, range };
  if (/^audio-\d{1,3}$/.test(action)) return { kind: "file", id, asset: Number(action.slice(6)), range };
  return null;
}

const cached = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, s-maxage=60",
};

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const url = new URL(request.url);
  const range = request.headers.get("range") ?? "";
  const target = parse(path, range);
  if (!target || url.search || range.length > 40) return new Response(null, { status: 404 });
  const key = process.env.LOAM_PUBLIC_KEY;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!key || !convexUrl) return new Response(null, { status: 503, headers: { "Retry-After": "60" } });

  try {
    const result = await new ConvexHttpClient(convexUrl).mutation(api.publicLibrary.read, { key, request: target }, { skipQueue: true });
    switch (result.kind) {
      case "missing":
        return new Response(null, { status: 404 });
      case "limited":
        return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
      case "range":
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${result.size}` } });
      case "catalog":
        return Response.json(result.books, { headers: cached });
      case "book":
        return Response.json({ book: result.book, audio: result.audio }, { headers: cached });
      case "preview":
        return Response.json(result.paragraphs, { headers: cached });
      case "file": {
        const partial = !!result.range;
        const upstream = await fetch(result.url, {
          cache: "no-store",
          redirect: "error",
          headers: partial ? { Range: result.range } : undefined,
          signal: request.signal,
        });
        if (upstream.status !== (partial ? 206 : 200) || !upstream.body ||
            Number(upstream.headers.get("content-length")) !== result.bytes) {
          await upstream.body?.cancel();
          return new Response(null, { status: 502 });
        }
        const audio = target.kind === "file" && typeof target.asset === "number";
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            ...(partial || audio ? { "Cache-Control": "private, no-store" } : cached),
            "Content-Type": result.mime,
            "Content-Length": String(result.bytes),
            "Accept-Ranges": "bytes",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
            ...(partial ? { "Content-Range": `${result.range.replace("=", " ")}/${result.size}` } : {}),
          },
        });
      }
    }
  } catch {
    return new Response(null, { status: 503, headers: { "Retry-After": "60" } });
  }
}
