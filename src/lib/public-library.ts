import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

type Result = FunctionReturnType<typeof api.publicLibrary.read>;
export type PublicBook = Extract<Result, { kind: "book" }>["book"];
export type PublicDetails = Pick<Extract<Result, { kind: "book" }>, "book" | "audio">;
export type PublicPreview = Extract<Result, { kind: "preview" }>["paragraphs"];

export const libraryPath = (id: string, asset: string) => `/api/library/${id}/${asset}`;
export const publicEpubKey = (id: string) => `public:${id}`;
