"use client";

import dynamic from "next/dynamic";
import { ReaderBlank } from "./reader-blank";

// The reader depends on IndexedDB, localStorage and epub.js, so it runs in the browser only.
export const ReaderClient = dynamic(() => import("./reader").then((m) => m.Reader), { ssr: false, loading: () => <ReaderBlank /> });
