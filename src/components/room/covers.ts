"use client";

import { useEffect, useState } from "react";

/** A loaded cover, usable as a WebGL texture source, and the colour of its left edge (for the spine). */
export type CoverImage = { img: HTMLImageElement; tone: string; ink: string };

const cache = new Map<string, Promise<CoverImage | null>>();

/** Whether any cover failed to load for WebGL use (e.g. CORS); reported once in the console. */
let warned = false;

function toHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/**
 * Loads a cover with CORS so it can be drawn into canvases and textures. Resolves to null when the
 * image can't be loaded or would taint the canvas, so callers fall back to a cloth cover.
 */
export function loadCover(url: string): Promise<CoverImage | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = new Promise<CoverImage | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 8;
        c.height = 32;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        // The leftmost tenth of the cover, squashed: its average colour suits the spine.
        g.drawImage(img, 0, 0, Math.max(1, img.naturalWidth * 0.1), img.naturalHeight, 0, 0, 8, 32);
        const d = g.getImageData(0, 0, 8, 32).data;
        let r = 0,
          gr = 0,
          b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          gr += d[i + 1];
          b += d[i + 2];
        }
        const n = d.length / 4;
        r /= n;
        gr /= n;
        b /= n;
        const lum = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
        resolve({ img, tone: toHex(r, gr, b), ink: lum > 0.55 ? "#2b2119" : "#efe4cf" });
      } catch {
        if (!warned) console.warn("Loam: book covers can't be used in WebGL here (CORS); using cloth covers.");
        warned = true;
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

/** The cover's spine tone for the flat shelf, once known. */
export function useCoverTone(url: string | null) {
  const [tone, setTone] = useState<{ url: string; tone: string; ink: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadCover(url).then((c) => {
      if (live && c) setTone({ url, tone: c.tone, ink: c.ink });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return tone && tone.url === url ? tone : null;
}
