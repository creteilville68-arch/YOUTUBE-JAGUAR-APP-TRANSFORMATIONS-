import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUtc(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const touch = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const today = todayUtc();
    const existing = await ctx.db
      .query("studyDays")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", today))
      .unique();
    if (existing) {
      if (existing.count > 0) {
        await ctx.db.patch(existing._id, { count: existing.count + 1 });
      }
      return;
    }
    await ctx.db.insert("studyDays", { userId, day: today, count: 1 });
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const days = await ctx.db
      .query("studyDays")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const daySet = new Set(days.map((d) => d.day));
    let streak = 0;
    let cursor = daySet.has(todayUtc()) ? todayUtc() : yesterdayUtc();
    while (daySet.has(cursor)) {
      streak += 1;
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    }
    return { streak, todayDone: daySet.has(todayUtc()) };
  },
});
