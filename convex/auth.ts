import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId, setupConvexAuth } from "@convex-dev/auth/server";
import { setupUsernamePassword } from "@convex-dev/auth/methods/username-password/server";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession } = auth;

export async function ownerId(ctx: Pick<QueryCtx, "auth" | "runQuery">) {
  const id = await getAuthUserId(ctx);
  return id && id === process.env.LOAM_OWNER_ID ? id : null;
}

export const isAuthenticated = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await ownerId(ctx)) !== null,
});

const credentials = { username: v.string(), password: v.string() };
const passwordAuth = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.users.createUser });

const signInResult = v.union(
  v.object({
    status: v.literal("error"),
    userError: v.union(
      v.object({ error: v.literal("INVALID_CREDENTIALS") }),
      v.object({ error: v.literal("RATE_LIMITED"), retryAfterMs: v.number() }),
    ),
  }),
  v.object({
    status: v.literal("complete"),
    tokens: v.object({ accessToken: v.string(), refreshToken: v.string(), refreshTokenExpiresAt: v.number(), userId: v.string() }),
  }),
);

type PasswordHandler<T> = {
  _handler: (ctx: MutationCtx, args: { username: string; password: string }) => Promise<T>;
};

export const signInWithUsernamePassword = mutation({
  args: credentials,
  returns: signInResult,
  handler: async (ctx, args) => {
    const invalid = { status: "error", userError: { error: "INVALID_CREDENTIALS" } } as const;
    if (args.username.length > 128 || args.password.length > 1024 || !process.env.LOAM_OWNER_ID) return invalid;
    const id = await ctx.runQuery(components.authUsername.public.getUserIdByUsername, { username: args.username });
    if (id !== process.env.LOAM_OWNER_ID) return invalid;
    // Call the bundled handler so failed attempts still use Convex Auth's password limiter.
    const signIn = passwordAuth.signInWithUsernamePassword as typeof passwordAuth.signInWithUsernamePassword & PasswordHandler<Infer<typeof signInResult> | { status: "error"; userError: { error: "USER_NOT_FOUND" } }>;
    const result = await signIn._handler(ctx, args);
    if (result.status === "complete") return result;
    if (result.userError.error === "RATE_LIMITED") return { status: "error" as const, userError: result.userError };
    return invalid;
  },
});

/** Fresh installations can provision an owner from the Convex deployment console. */
export const createOwner = internalMutation({
  args: credentials,
  returns: v.id("users"),
  handler: async (ctx, args) => {
    if (process.env.LOAM_OWNER_ID) throw new ConvexError("An owner is already configured");
    // Reuse Convex Auth’s signup handler without registering a public signup endpoint.
    const signup = passwordAuth.signUpWithUsernamePassword as typeof passwordAuth.signUpWithUsernamePassword & PasswordHandler<{ status: "complete" } | { status: "error"; userError: { error: string } }>;
    const result = await signup._handler(ctx, args);
    if (result.status !== "complete") throw new ConvexError(result.userError.error);
    const id = await ctx.runQuery(components.authUsername.public.getUserIdByUsername, { username: args.username });
    const owner = id && ctx.db.normalizeId("users", id);
    if (!owner) throw new ConvexError("Could not create owner");
    return owner;
  },
});
