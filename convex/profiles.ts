import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const save = mutation({
  args: {
    displayName: v.string(),
    nativeLang: v.string(),
    nativeLangCode: v.string(),
  },
  handler: async (ctx, { displayName, nativeLang, nativeLangCode }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const fields = { displayName: displayName.trim() || "Estudante", nativeLang, nativeLangCode };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("profiles", { userId, ...fields });
  },
});
