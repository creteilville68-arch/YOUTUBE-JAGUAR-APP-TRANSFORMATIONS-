import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./authHelpers";
import { splitIntoParts } from "./textSplit";

export const create = mutation({
  args: {
    title: v.string(),
    rawText: v.string(),
    targetLang: v.string(),
    nativeLang: v.string(),
    youtubeUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    videoId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { title, rawText, targetLang, nativeLang, youtubeUrl, thumbnailUrl, videoId },
  ) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const lessonId = await ctx.db.insert("lessons", {
      userId,
      title: title.trim() || "Aula sem título",
      targetLang,
      nativeLang,
      status: "draft",
      wordCount,
      rawTranscript: rawText,
      youtubeUrl,
      thumbnailUrl,
      videoId,
      createdAt: now,
      updatedAt: now,
    });
    return lessonId;
  },
});

// Create a series of lessons from one long transcript: "Título — Parte 1/N",
// "Parte 2/N", … each an independent lesson (own pipeline run, own video sync).
export const createSplit = mutation({
  args: {
    title: v.string(),
    rawText: v.string(),
    targetLang: v.string(),
    nativeLang: v.string(),
    youtubeUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    videoId: v.optional(v.string()),
    maxWordsPerPart: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      title,
      rawText,
      targetLang,
      nativeLang,
      youtubeUrl,
      thumbnailUrl,
      videoId,
      maxWordsPerPart,
    },
  ) => {
    const userId = await requireUserId(ctx);
    const parts = splitIntoParts(rawText, maxWordsPerPart ?? 1800);
    if (parts.length === 0) throw new Error("Transcrição vazia.");
    const groupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const ids = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const wordCount = part.split(/\s+/).filter(Boolean).length;
      const label =
        parts.length > 1 ? `${title.trim() || "Aula sem título"} — Parte ${i + 1}/${parts.length}` : title.trim() || "Aula sem título";
      const id = await ctx.db.insert("lessons", {
        userId,
        title: label,
        targetLang,
        nativeLang,
        status: "draft",
        wordCount,
        rawTranscript: part,
        youtubeUrl,
        thumbnailUrl,
        videoId,
        groupId,
        partIndex: i + 1,
        partCount: parts.length,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    // Server-side queue: the first part starts in seconds; subsequent parts are
    // chained by the scheduler after each run. Survives page reloads entirely.
    await ctx.scheduler.runAfter(2000, internal.lessons.enqueue, {
      lessonId: ids[0],
    });
    return { ids, groupId };
  },
});

export const getGroup = query({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("lessons")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("asc")
      .collect()
      .then((rows) => rows.filter((r) => r.userId === userId));
  },
});

export const get = query({
  args: { id: v.id("lessons") },
  handler: async (ctx, { id }) => {
    await requireUserId(ctx);
    return await ctx.db.get(id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("lessons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const start = mutation({
  args: { id: v.id("lessons") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) throw new Error("Aula não encontrada.");
    if (lesson.status === "ready") return;
    if (lesson.status === "processing" && Date.now() - lesson.updatedAt < 5 * 60_000) return;
    if (lesson.status === "processing" && (lesson.workerLeaseUntil ?? 0) > Date.now()) return;
    if (lesson.status !== "draft" && lesson.status !== "failed" && lesson.status !== "processing") return;

    // Start only from an atomic mutation. This prevents the browser and the
    // server queue from launching two independent AI pipelines for one lesson.
    await ctx.db.patch(id, {
      status: "processing",
      progress: "Na fila de geração…",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.pipelineQueue.runQueue, { lessonId: id });
  },
});

export const markStatus = mutation({
  args: {
    id: v.id("lessons"),
    status: v.union(v.literal("processing"), v.literal("failed")),
  },
  handler: async (ctx, { id, status }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) throw new Error("Aula não encontrada.");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
  },
});

export const patchProgress = mutation({
  args: {
    id: v.id("lessons"),
    step: v.number(),
    label: v.string(),
  },
  handler: async (ctx, { id, step, label }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) return;
    const now = Date.now();
    await ctx.db.patch(id, {
      progress: label,
      progressStep: step,
      updatedAt: now,
      workerLeaseUntil: now + 10 * 60_000,
    });
  },
});

export const persistResult = mutation({
  args: {
    id: v.id("lessons"),
    blocks: v.array(v.any()),
    summary: v.string(),
    timeMap: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { id, blocks, summary, timeMap }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) throw new Error("Aula não encontrada.");
    await ctx.db.patch(id, {
      status: "ready",
      blocks,
      summary,
      progress: "",
      updatedAt: Date.now(),
      ...(timeMap ? { timeMap } : {}),
    });
  },
});

// ---- Internal (scheduler-only) variants: scheduled actions run without user
// identity, so the pipeline must call these instead of the auth-checked ones.

// Flip a queued lesson to processing and start its scheduled pipeline run.
// Accepts drafts (first run) and failed lessons (timed retry from chainNext).
// Lives here (V8) because mutations cannot be defined in "use node" files.
export const enqueue = internalMutation({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    const lesson = await ctx.db.get(lessonId);
    if (!lesson || (lesson.status !== "draft" && lesson.status !== "failed")) return;
    await ctx.db.patch(lessonId, {
      status: "processing",
      progress: "Na fila de geração…",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.pipelineQueue.runQueue, { lessonId });
  },
});

export const claimWorker = internalMutation({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    const lesson = await ctx.db.get(lessonId);
    if (!lesson || lesson.status === "ready") return null;
    const now = Date.now();
    if (lesson.status === "processing" && (lesson.workerLeaseUntil ?? 0) > now) return null;

    const workerToken = `worker_${now}_${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.patch(lessonId, {
      status: "processing",
      workerToken,
      workerLeaseUntil: now + 10 * 60_000,
      updatedAt: now,
      progress: lesson.progress || "Retomando a geração…",
    });
    return workerToken;
  },
});

export const releaseWorker = internalMutation({
  args: { lessonId: v.id("lessons"), workerToken: v.string() },
  handler: async (ctx, { lessonId, workerToken }) => {
    const lesson = await ctx.db.get(lessonId);
    if (!lesson || lesson.workerToken !== workerToken) return;
    await ctx.db.patch(lessonId, { workerLeaseUntil: 0 });
  },
});

// ---- Global AI generation slot (single-row table "pipelineSlots") ----
// The free-tier AI quota is shared by EVERY lesson. When the cron revives a
// backlog after downtime, all stuck lessons used to retry in the same second,
// hit 429 together, park, and retry together again — a thundering herd that
// starved generation for hours (seen in logs: 7 parallel 429s at one instant).
// One lesson generates at a time; the others queue behind it with a visible
// "na fila" status instead of failing.
const SLOT_LEASE_MS = 11 * 60_000; // > per-run work budget + backoffs (< platform 600s kill)

export const claimSlot = internalMutation({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    const now = Date.now();
    // Insert-then-requery under snapshot isolation can create duplicate rows
    // when the table is empty; keep the oldest row and drop the rest.
    let rows = await ctx.db.query("pipelineSlots").collect();
    if (rows.length === 0) {
      await ctx.db.insert("pipelineSlots", {});
      return null; // this claim loses; the next poll finds the fresh row
    }
    rows.sort((a, b) => a._id.localeCompare(b._id));
    const slot = rows[0];
    for (let i = 1; i < rows.length; i++) await ctx.db.delete(rows[i]._id);
    const free =
      !slot.leaseUntil || slot.leaseUntil <= now || slot.holderLessonId === lessonId;
    if (!free) return null;
    const token = `slot_${now}_${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.patch(slot._id, {
      holderLessonId: lessonId,
      leaseUntil: now + SLOT_LEASE_MS,
      token,
    });
    return token;
  },
});

export const releaseSlot = internalMutation({
  args: { lessonId: v.id("lessons"), token: v.string() },
  handler: async (ctx, { lessonId, token }) => {
    const slot = await ctx.db.query("pipelineSlots").first();
    if (!slot || slot.token !== token) return;
    await ctx.db.patch(slot._id, {
      holderLessonId: undefined,
      leaseUntil: 0,
      token: undefined,
    });
  },
});

export const internalGetGroup = internalQuery({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    return await ctx.db
      .query("lessons")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("asc")
      .collect();
  },
});

export const internalGet = internalQuery({
  args: { id: v.id("lessons") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const internalSetStatus = internalMutation({
  args: {
    id: v.id("lessons"),
    // "draft" included: the queue parks rate-limited lessons back to draft so
    // a later `enqueue` retry (which only accepts drafts) picks them up again.
    status: v.union(v.literal("draft"), v.literal("processing"), v.literal("failed")),
    progress: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, progress }) => {
    await ctx.db.patch(id, {
      status,
      updatedAt: Date.now(),
      ...(progress !== undefined ? { progress } : {}),
    });
  },
});

// Save incremental generation progress so the pipeline can resume after an
// action timeout instead of restarting from zero (free-tier rate limits make a
// full run outlive one action execution).
export const internalSaveCheckpoint = internalMutation({
  args: {
    id: v.id("lessons"),
    fixedChunks: v.optional(v.array(v.string())),
    blocks: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { id, fixedChunks, blocks }) => {
    const lesson = await ctx.db.get(id);
    if (!lesson) return;
    const prev = lesson.checkpoint ?? {};
    const now = Date.now();
    await ctx.db.patch(id, {
      checkpoint: {
        ...(fixedChunks !== undefined ? { fixedChunks } : { fixedChunks: prev.fixedChunks }),
        ...(blocks !== undefined ? { blocks } : { blocks: prev.blocks }),
      },
      updatedAt: now,
      workerLeaseUntil: now + 10 * 60_000,
    });
    // Keep the global AI slot alive while this lesson is actively checkpointing.
    const slot = await ctx.db.query("pipelineSlots").first();
    if (slot && slot.holderLessonId === id) {
      await ctx.db.patch(slot._id, { leaseUntil: now + SLOT_LEASE_MS });
    }
  },
});

export const internalPatchProgress = internalMutation({
  args: { id: v.id("lessons"), step: v.number(), label: v.string() },
  handler: async (ctx, { id, step, label }) => {
    const now = Date.now();
    await ctx.db.patch(id, {
      progress: label,
      progressStep: step,
      updatedAt: now,
      workerLeaseUntil: now + 10 * 60_000,
    });
    // Keep the global AI slot alive while this lesson is actively working.
    const slot = await ctx.db.query("pipelineSlots").first();
    if (slot && slot.holderLessonId === id) {
      await ctx.db.patch(slot._id, { leaseUntil: now + SLOT_LEASE_MS });
    }
  },
});

export const internalPersistResult = internalMutation({
  args: {
    id: v.id("lessons"),
    blocks: v.array(v.any()),
    summary: v.string(),
    timeMap: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { id, blocks, summary, timeMap }) => {
    await ctx.db.patch(id, {
      status: "ready",
      blocks,
      summary,
      progress: "",
      updatedAt: Date.now(),
      ...(timeMap ? { timeMap } : {}),
    });
  },
});

// Periodic sweeper (runs via convex/crons.ts every 3 minutes): revives lessons
// whose generation queue died — platform-killed action runs, sandbox restarts,
// or retry schedules that never fired while the backend was down. The browser
// no longer needs to be open for a lesson to finish generating.
export const reviveStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("lessons").collect();
    let revived = 0;

    // Group view for series analysis.
    const byGroup = new Map<string, typeof all>();
    for (const lesson of all) {
      if (!lesson.groupId) continue;
      const list = byGroup.get(lesson.groupId) ?? [];
      list.push(lesson);
      byGroup.set(lesson.groupId, list);
    }

    for (const lesson of all) {
      if (
        lesson.status === "processing" &&
        now - lesson.updatedAt > 5 * 60_000 &&
        (lesson.workerLeaseUntil ?? 0) <= now
      ) {
        // Run was killed mid-flight (timeout or backend restart). The queue
        // action will atomically claim the expired lease before resuming from
        // the checkpoint, so repeated cron ticks cannot create duplicate AI runs.
        // Stagger start times so a large backlog doesn't fire every poll at the
        // same instant (they serialize on the AI slot anyway).
        const delay = Math.min(revived * 20_000, 180_000);
        await ctx.scheduler.runAfter(delay, internal.pipelineQueue.runQueue, {
          lessonId: lesson._id,
        });
        revived++;
      } else if (lesson.status === "draft" && lesson.checkpoint) {
        // Parked mid-generation (e.g. free-tier rate limit) and its scheduled
        // retry never fired (backend was down when the time came).
        const delay = Math.min(revived * 20_000, 180_000);
        await ctx.scheduler.runAfter(delay, internal.lessons.enqueue, {
          lessonId: lesson._id,
        });
        revived++;
      }
    }

    // Dead series queues: a series whose drafts sat untouched for 10+ minutes
    // with nothing processing means its kickoff/retry schedules were lost (e.g.
    // sandbox died right after creation). Restart the first queued part —
    // chainNext re-chains the remaining parts in order from there.
    for (const [groupId, parts] of byGroup) {
      const drafts = parts
        .filter((p) => p.status === "draft")
        .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0));
      if (drafts.length === 0) continue;
      const anyActive = parts.some(
        (p) => p.status === "processing" || now - p.updatedAt < 10 * 60_000,
      );
      if (anyActive) continue;
      const delay = Math.min(revived * 20_000, 180_000);
      await ctx.scheduler.runAfter(delay, internal.lessons.enqueue, {
        lessonId: drafts[0]._id,
      });
      revived++;
      void groupId;
    }
    return revived;
  },
});

// Public mirror of the checkpoint mutation so browser-triggered runs also
// survive interruption: a partial browser run leaves resumable progress behind.
export const saveCheckpoint = mutation({
  args: {
    id: v.id("lessons"),
    fixedChunks: v.optional(v.array(v.string())),
    blocks: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { id, fixedChunks, blocks }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) return;
    const prev = lesson.checkpoint ?? {};
    await ctx.db.patch(id, {
      checkpoint: {
        ...(fixedChunks !== undefined ? { fixedChunks } : { fixedChunks: prev.fixedChunks }),
        ...(blocks !== undefined ? { blocks } : { blocks: prev.blocks }),
      },
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("lessons") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const lesson = await ctx.db.get(id);
    if (!lesson || lesson.userId !== userId) throw new Error("Aula não encontrada.");
    const vocab = await ctx.db
      .query("vocab")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const item of vocab) {
      if (item.lessonId === id) {
        const cards = await ctx.db
          .query("cards")
          .withIndex("by_vocab", (q) => q.eq("vocabId", item._id))
          .collect();
        for (const card of cards) await ctx.db.delete(card._id);
        await ctx.db.delete(item._id);
      }
    }
    await ctx.db.delete(id);
  },
});
