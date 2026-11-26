import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Called by Convex Auth when someone signs up. */
export const createUser = internalMutation({
  args: { method: v.object({ name: v.string(), profile: v.any() }) },
  returns: v.id("users"),
  handler: async (ctx) => ctx.db.insert("users", { createdAt: Date.now() }),
});
