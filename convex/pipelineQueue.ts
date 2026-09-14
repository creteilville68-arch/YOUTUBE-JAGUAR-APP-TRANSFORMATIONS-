"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { runPipelineCore, RateLimitError } from "./pipeline";

// Server-side generation queue. Free-tier AI rate limits mean a long lesson can
// outlive a single action run (600s platform timeout), so each run does up to
// ~8 minutes of checkpointed work and — if unfinished — reschedules itself to
// continue from the checkpoint. The user can close the browser entirely: the
// series still generates itself, one continuation at a time.
export const runQueue = internalAction({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    const workerToken = await ctx.runMutation(internal.lessons.claimWorker, { lessonId });
    if (!workerToken) return;

    // Global serialization: only ONE lesson may use the AI quota at a time.
    // Without this, a post-downtime backlog revived all lessons at once and
    // every call hit the free-tier 429 in the same second (seen in logs).
    const slotToken = await ctx.runMutation(internal.lessons.claimSlot, { lessonId });
    if (!slotToken) {
      // Another lesson holds the slot. Free this run's worker lease NOW (the
      // scheduled retry re-claims it — returning early would skip the finally
      // below and leave the lease held, stalling the retry), show a visible
      // queued state, and poll again with jitter so queued lessons don't sync
      // into a herd.
      await ctx.runMutation(internal.lessons.releaseWorker, { lessonId, workerToken });
      await ctx.runMutation(internal.lessons.internalSetStatus, {
        id: lessonId,
        status: "processing",
        progress: "Na fila: outra aula está gerando agora…",
      });
      const delay = 15_000 + Math.floor(Math.random() * 10_000);
      await ctx.scheduler.runAfter(delay, internal.pipelineQueue.runQueue, { lessonId });
      return;
    }

    // A partial run hands off to its continuation WITHOUT releasing the slot,
    // so the same lesson keeps priority and isn't sent to the back of the queue.
    let keepSlot = false;
    try {
      // Arm the liveness watchdog before working. If the platform kills this
      // action, the watchdog can schedule a recovery after the lease expires.
      await ctx.scheduler.runAfter(660_000, internal.pipelineQueue.watchdog, { lessonId });

      let failed = false;
      try {
        const result = await runPipelineCore(ctx, lessonId, true);
        if (!result.done) {
          // Out of time, work saved — continue in a fresh run.
          keepSlot = true;
          await ctx.scheduler.runAfter(1000, internal.pipelineQueue.runQueue, { lessonId });
          return;
        }
      } catch (e) {
        if (e instanceof RateLimitError) {
          // Free-tier quota exhausted. Park the lesson and retry later without
          // losing the checkpoint or leaving it in processing forever.
          await ctx.runMutation(internal.lessons.internalSetStatus, {
            id: lessonId,
            status: "draft",
            progress: "Aguarde: cota gratuita da IA repondo… tentando de novo em ~2 min",
          });
          await ctx.scheduler.runAfter(120_000, internal.lessons.enqueue, { lessonId });
          return;
        }
        failed = true;
        const msg = e instanceof Error ? e.message : "Erro desconhecido na geração.";
        await ctx.runMutation(internal.lessons.internalSetStatus, {
          id: lessonId,
          status: "failed",
          progress: msg.slice(0, 200),
        });
      }

      // On failure, retry the same series part; on success, start the next one.
      const lesson = await ctx.runQuery(internal.lessons.internalGet, { id: lessonId });
      await chainNext(ctx, lesson?.groupId, failed ? lessonId : undefined);
    } finally {
      // Always release the lease, including partial runs and scheduled retries.
      // If the action is killed externally, the lease expires and the watchdog
      // can reclaim it later.
      await ctx.runMutation(internal.lessons.releaseWorker, {
        lessonId,
        workerToken,
      });
      if (!keepSlot) {
        await ctx.runMutation(internal.lessons.releaseSlot, { lessonId, token: slotToken });
      }
    }
  },
});

// Liveness watchdog: fires ~60s after a run could have been platform-killed.
// If the lesson is still "processing" and no checkpoint write happened in the
// last 5 minutes, the run is dead — resume it from its checkpoint.
export const watchdog = internalAction({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    const lesson = await ctx.runQuery(internal.lessons.internalGet, { id: lessonId });
    if (!lesson || lesson.status !== "processing") return;
    const staleMs = Date.now() - (lesson.updatedAt ?? 0);
    if (staleMs < 300_000) return; // a live run writes checkpoints frequently
    await ctx.scheduler.runAfter(0, internal.pipelineQueue.runQueue, { lessonId });
  },
});

// When a lesson finishes (or fails), start the next draft part of the series.
// `resumeAfter` marks the id of a FAILED lesson: on failure we retry the same
// part once after 60s (transient rate limits), and only give up permanently
// after 3 failed attempts (attempt counter stored in progress).
async function chainNext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { runQuery: (ref: any, args: any) => Promise<any>; runMutation: (ref: any, args: any) => Promise<any>; scheduler: { runAfter: (d: number, ref: any, args: any) => Promise<unknown> } },
  groupId?: string,
  resumeAfter?: string,
) {
  if (!groupId) return;
  const parts = (await ctx.runQuery(internal.lessons.internalGetGroup, {
    groupId,
  })) as { _id: string; status: string; progress?: string }[];
  const failedPart = parts.find((p) => p._id === resumeAfter);
  if (failedPart) {
    const attempts = Number(failedPart.progress?.match(/#(\d)$/)?.[1] ?? 0);
    if (attempts < 3) {
      await ctx.runMutation(internal.lessons.internalSetStatus, {
        id: failedPart._id,
        status: "failed",
        progress: `${failedPart.progress?.replace(/ #\d$/, "") ?? "Falha na geração."} #${attempts + 1}`,
      });
      await ctx.scheduler.runAfter(60_000, internal.lessons.enqueue, {
        lessonId: failedPart._id,
      });
      return;
    }
    // 3 attempts exhausted — keep failed, move on to the next draft part.
  }
  const next = parts.find((p) => p.status === "draft");
  if (next) {
    await ctx.scheduler.runAfter(3000, internal.lessons.enqueue, { lessonId: next._id });
  }
}
