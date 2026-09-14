import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

const DAY_MS = 24 * 60 * 60 * 1000;

// Simplified SM-2: grades are again | hard | good | easy.
export const grade = mutation({
  args: {
    cardId: v.id("cards"),
    grade: v.union(
      v.literal("again"),
      v.literal("hard"),
      v.literal("good"),
      v.literal("easy"),
    ),
  },
  handler: async (ctx, { cardId, grade: g }) => {
    const userId = await requireUserId(ctx);
    const card = await ctx.db.get(cardId);
    if (!card || card.userId !== userId) throw new Error("Cartão não encontrado.");
    let { intervalDays, easeFactor, reps, lapses } = card;
    if (g === "again") {
      lapses += 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      intervalDays = 0;
      reps = 0;
    } else {
      const bump = g === "hard" ? -0.15 : g === "easy" ? 0.15 : 0;
      easeFactor = Math.max(1.3, easeFactor + bump);
      reps += 1;
      if (reps === 1) {
        intervalDays = g === "hard" ? 1 : g === "easy" ? 3 : 2;
      } else {
        intervalDays = Math.max(1, Math.round(intervalDays * (g === "hard" ? 1.2 : easeFactor)));
        if (g === "easy") intervalDays += 1;
      }
    }
    const dueAt = Date.now() + intervalDays * DAY_MS;
    await ctx.db.patch(cardId, {
      intervalDays,
      easeFactor,
      reps,
      lapses,
      dueAt,
      lastGrade: g,
    });
    return { intervalDays, dueAt };
  },
});

export const dueCards = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const due = cards.filter((c) => c.dueAt <= now);
    const items = await Promise.all(due.map((c) => ctx.db.get(c.vocabId)));
    const out: {
      cardId: typeof cards[number]["_id"];
      term: string;
      meanings: string[];
      wordClass: string;
      examples: { target: string; native: string }[];
      contextNote: string;
    }[] = [];
    for (let i = 0; i < due.length; i++) {
      const vocab = items[i];
      if (vocab) {
        out.push({
          cardId: due[i]._id,
          term: vocab.term,
          meanings: vocab.meanings,
          wordClass: vocab.wordClass,
          examples: vocab.examples,
          contextNote: vocab.contextNote,
        });
      }
    }
    return out;
  },
});
