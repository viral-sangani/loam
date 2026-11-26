"use client";

import { useState } from "react";
import { Sprout } from "lucide-react";
import {
  useSignInWithUsernamePassword,
  useSignUpWithUsernamePassword,
} from "@convex-dev/auth/methods/username-password/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "That username and password don't match.",
  USER_NOT_FOUND: "No account with that username. Create one instead?",
  USERNAME_TAKEN: "That username is taken.",
  USERNAME_TOO_SHORT: "Pick a longer username.",
  USERNAME_TOO_LONG: "Pick a shorter username.",
  USERNAME_HAS_INVALID_CHARACTERS: "Use letters, numbers, dots, dashes or underscores.",
  USERNAME_HAS_SURROUNDING_WHITESPACE: "Remove the spaces around the username.",
  PASSWORD_TOO_SHORT: "Use a longer password.",
  PASSWORD_TOO_LONG: "Use a shorter password.",
  PASSWORD_TOO_COMMON: "That password is too common. Try another.",
  PASSWORD_HAS_SURROUNDING_WHITESPACE: "Remove the spaces around the password.",
  RATE_LIMITED: "Too many tries. Wait a moment and try again.",
};

const input =
  "h-11 w-full rounded-xl border border-border bg-card px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60";

export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const { signIn, pending: signingIn } = useSignInWithUsernamePassword(api.auth);
  const { signUp, pending: signingUp } = useSignUpWithUsernamePassword(api.auth);
  const pending = signingIn || signingUp;

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      <div className="mb-10 flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sprout className="size-4" />
        </span>
        <span className="font-serif text-2xl tracking-tight">Loam</span>
      </div>
      <h1 className="font-serif text-3xl">{mode === "in" ? "Welcome back" : "Make a shelf"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your books, audio and notes follow you to any device.</p>

      <form
        className="mt-8 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const credentials = { username: String(form.get("username")), password: String(form.get("password")) };
          setError(null);
          const result = mode === "in" ? await signIn(credentials) : await signUp(credentials);
          if (result.status === "error") {
            const code = (result.userError as { error?: string }).error ?? "OTHER_ERROR";
            setError(MESSAGES[code] ?? "Something went wrong. Try again.");
          }
        }}
      >
        <input name="username" autoComplete="username" placeholder="Username" required className={input} />
        <input
          name="password"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          placeholder="Password"
          required
          className={input}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl text-base">
          {pending ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
        }}
        className="mt-6 text-sm text-muted-foreground hover:text-foreground"
      >
        {mode === "in" ? "New here? " : "Have an account? "}
        <span className="text-primary underline underline-offset-4">{mode === "in" ? "Create an account" : "Sign in"}</span>
      </button>
    </div>
  );
}
