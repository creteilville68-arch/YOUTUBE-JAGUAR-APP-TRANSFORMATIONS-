import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    tokenIdentifier: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("tokenIdentifier", ["tokenIdentifier"]),

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    nativeLang: v.string(), // English value, e.g. "Portuguese (Brazil)"
    nativeLangCode: v.string(), // BCP 47, e.g. "pt-BR"
  }).index("by_user", ["userId"]),

  lessons: defineTable({
    userId: v.id("users"),
    title: v.string(),
    targetLang: v.string(),
    nativeLang: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    summary: v.optional(v.string()),
    summaryNative: v.optional(v.string()),
    blocks: v.optional(v.array(v.any())),
    wordCount: v.optional(v.number()),
    rawTranscript: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    videoId: v.optional(v.string()),
    progress: v.optional(v.string()),
    progressStep: v.optional(v.number()),
    // Checkpoint for resumable generation: free-tier AI rate limits mean a part
    // can outlive a single action run, so progress is persisted continuously and
    // the queue resumes from here instead of starting over.
    checkpoint: v.optional(
      v.object({
        fixedChunks: v.optional(v.array(v.string())),
        blocks: v.optional(v.array(v.any())),
      }),
    ),
    timeMap: v.optional(v.array(v.any())),
    groupId: v.optional(v.string()), // series of parts from one long video
    partIndex: v.optional(v.number()), // 1-based
    partCount: v.optional(v.number()),
    // Lease for the server-side generation worker. It prevents the watchdog or
    // a duplicate schedule from running two AI pipelines for the same lesson.
    workerToken: v.optional(v.string()),
    workerLeaseUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"]),

  vocab: defineTable({
    userId: v.id("users"),
    lessonId: v.optional(v.id("lessons")),
    term: v.string(),
    wordClass: v.string(),
    meanings: v.array(v.string()),
    contextNote: v.string(),
    examples: v.array(v.object({ target: v.string(), native: v.string() })),
    sourceSentence: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_lesson", ["lessonId"]),

  cards: defineTable({
    userId: v.id("users"),
    vocabId: v.id("vocab"),
    intervalDays: v.number(),
    easeFactor: v.number(),
    reps: v.number(),
    lapses: v.number(),
    dueAt: v.number(),
    lastGrade: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_vocab", ["vocabId"]),

  studyDays: defineTable({
    userId: v.id("users"),
    day: v.string(), // UTC date, e.g. "2026-09-13"
    count: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_day", ["userId", "day"]),

  // Global generation slot: free-tier AI quota is shared by every lesson, so
  // only ONE lesson may generate at a time (per-lesson worker leases prevent
  // duplicates of the same lesson; this prevents 7 lessons hammering Gemini
  // in the same second and all getting 429). Single-row table: _id "global".
  pipelineSlots: defineTable({
    holderLessonId: v.optional(v.id("lessons")),
    leaseUntil: v.optional(v.number()),
    // Per-claim token: two queued runs of the SAME lesson can race; only the
    // run that actually holds this token may release/renew the slot.
    token: v.optional(v.string()),
  }),
});
