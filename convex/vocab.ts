import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

export const listVocab = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const items = await ctx.db
      .query("vocab")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const cardByVocab = new Map(cards.map((c) => [c.vocabId, c]));
    const lessons = await Promise.all(
      items.map((item) => (item.lessonId ? ctx.db.get(item.lessonId) : null)),
    );
    return items.map((item, i) => ({
      ...item,
      card: cardByVocab.get(item._id) ?? null,
      targetLang: lessons[i]?.targetLang ?? null,
      nativeLang: lessons[i]?.nativeLang ?? null,
    }));
  },
});

export const addVocab = mutation({
  args: {
    entry: v.object({
      term: v.string(),
      wordClass: v.string(),
      meanings: v.array(v.string()),
      contextNote: v.string(),
      examples: v.array(v.object({ target: v.string(), native: v.string() })),
    }),
    lessonId: v.optional(v.id("lessons")),
    sourceSentence: v.optional(v.string()),
  },
  handler: async (ctx, { entry, lessonId, sourceSentence }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("vocab")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const dup = existing.find(
      (e) => e.term.toLowerCase() === entry.term.toLowerCase() && e.lessonId === lessonId,
    );
    if (dup) return dup._id;
    const now = Date.now();
    const vocabId = await ctx.db.insert("vocab", {
      userId,
      lessonId,
      term: entry.term,
      wordClass: entry.wordClass,
      meanings: entry.meanings,
      contextNote: entry.contextNote,
      examples: entry.examples,
      sourceSentence,
      createdAt: now,
    });
    await ctx.db.insert("cards", {
      userId,
      vocabId,
      intervalDays: 0,
      easeFactor: 2.5,
      reps: 0,
      lapses: 0,
      dueAt: now,
    });
    return vocabId;
  },
});

export const saveExamples = mutation({
  args: {
    vocabId: v.id("vocab"),
    examples: v.array(v.object({ target: v.string(), native: v.string() })),
  },
  handler: async (ctx, { vocabId, examples }) => {
    await requireUserId(ctx);
    const item = await ctx.db.get(vocabId);
    if (!item) throw new Error("Palavra não encontrada.");
    await ctx.db.patch(vocabId, { examples });
    return examples;
  },
});

export const removeVocab = mutation({
  args: { id: v.id("vocab") },
  handler: async (ctx, { id }) => {
    await requireUserId(ctx);
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_vocab", (q) => q.eq("vocabId", id))
      .collect();
    for (const card of cards) await ctx.db.delete(card._id);
    await ctx.db.delete(id);
  },
});
