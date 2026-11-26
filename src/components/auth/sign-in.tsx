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
  "h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/20";

export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const { signIn, pending: signingIn } = useSignInWithUsernamePassword(api.auth);
  const { signUp, pending: signingUp } = useSignUpWithUsernamePassword(api.auth);
  const pending = signingIn || signingUp;

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      <div className="mb-10 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sprout className="size-4" />
        </span>
        <span className="font-serif text-lg leading-7 font-medium">Loam</span>
      </div>
      <h1 className="font-serif text-2xl leading-8">{mode === "in" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your books, audiobooks and notes, synced across devices.</p>

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
        <input name="username" aria-label="Username" autoComplete="username" placeholder="Username" required className={input} />
        <input
          name="password"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
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
        <Button type="submit" disabled={pending} className="h-11 w-full cursor-pointer rounded-lg text-sm">
          {pending ? (mode === "in" ? "Signing in…" : "Creating account…") : mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
        }}
        className="mt-6 min-h-11 cursor-pointer self-start text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {mode === "in" ? "New here? " : "Have an account? "}
        <span className="text-primary underline underline-offset-4">{mode === "in" ? "Create an account" : "Sign in"}</span>
      </button>
    </div>
  );
}
