"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { useSignInWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { api } from "@convex/_generated/api";
import { Btn } from "@/components/reader/kit";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "That username and password don't match.",
  RATE_LIMITED: "Too many tries. Wait a moment and try again.",
};

const input =
  "h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/20";

const subscribe = () => () => {};

export function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const { signIn, pending } = useSignInWithUsernamePassword(api.auth);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const owner = useQuery(api.auth.isAuthenticated, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (owner) router.replace("/");
  }, [owner, router]);

  return (
    // Sideways phones: the welcome on the left and the form on the right, so both fit the short screen.
    <div data-reader-theme="paper" className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16 short:grid short:max-w-3xl short:grid-cols-2 short:content-center short:items-center short:gap-x-12 short:pt-[max(1.5rem,env(safe-area-inset-top))] short:pr-[max(1.5rem,env(safe-area-inset-right))] short:pb-[max(1.5rem,env(safe-area-inset-bottom))] short:pl-[max(1.5rem,env(safe-area-inset-left))]">
      <div>
        <p className="mb-10 font-book text-lg leading-7 font-medium short:mb-6">Loam</p>
        <h1 className="font-book text-2xl leading-8">Owner sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage the library and audiobooks.</p>
      </div>

      <div className="flex flex-col">
        <form
          method="post"
          className="mt-8 space-y-3 short:mt-0"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const credentials = { username: String(form.get("username")), password: String(form.get("password")) };
            setError(null);
            const result = await signIn(credentials);
            if (result.status === "error") {
              const code = (result.userError as { error?: string }).error ?? "OTHER_ERROR";
              setError(MESSAGES[code] ?? "Something went wrong. Try again.");
            }
          }}
        >
          <input name="username" aria-label="Username" autoComplete="username" placeholder="Username" required className={input} />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            required
            className={input}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Btn type="submit" tone="primary" disabled={!ready || pending} className="h-11 w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Btn>
        </form>
      </div>
    </div>
  );
}
