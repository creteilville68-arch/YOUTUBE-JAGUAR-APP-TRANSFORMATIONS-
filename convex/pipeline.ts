"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireUserId } from "./authHelpers";
import { chunkWords, splitSentences, chunkSentences, looksPunctuated } from "./textSplit";

type LessonBlock = {
  sensTarget?: string;
  sensNative?: string;
  groups: {
    sentences: { target: string; native: string }[];
    vocab: {
      term: string;
      wordClass: string;
      meanings: string[];
      contextNote: string;
      examples: { target: string; native: string }[];
    }[];
  }[];
};

type Checkpoint = {
  fixedChunks?: string[];
  blocks?: LessonBlock[];
};

// Thrown when the free-tier quota stays exhausted even after in-run backoffs —
// the queue treats it as "park and retry later", not "lesson failed".
export class RateLimitError extends Error {}

// ~5 minutes of work per run. Platform action timeout is 600s; the margin
// absorbs a worst-case in-flight AI call with 429 backoff. If the budget runs
// out the run saves its checkpoint and the queue continues in a fresh run; if
// the platform still kills a run, the watchdog in pipelineQueue revives it.
const TIME_BUDGET_MS = 5 * 60 * 1000;

// Minimal shape both GenericActionCtx (public) and the internal action ctx
// satisfy — typed loosely because the function references are passed opaque.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunCtx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runQuery: (ref: any, args: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMutation: (ref: any, args: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runAction: (ref: any, args: any) => Promise<any>;
};

// Shared generation core. `useInternal` switches between the auth-checked
// functions (browser-triggered runs) and the scheduler-only ones (server queue
// runs, which execute without user identity). Progress is checkpointed to the
// database after every AI call; returns `done` when the lesson is complete, or
// `more: true` when the run needs another one (timeout-safe handoff).
export async function runPipelineCore(
  ctx: RunCtx,
  lessonId: string,
  useInternal: boolean,
): Promise<{ done: boolean; sentenceCount?: number; blockCount?: number }> {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const get = <T>(args: { id: string }) =>
    ctx.runQuery(useInternal ? internal.lessons.internalGet : api.lessons.get, args) as Promise<T>;
  const patchProgress = (step: number, label: string) =>
    ctx.runMutation(
      useInternal ? internal.lessons.internalPatchProgress : api.lessons.patchProgress,
      { id: lessonId, step, label },
    );
  const saveCheckpoint = (args: { fixedChunks?: string[]; blocks?: LessonBlock[] }) =>
    ctx.runMutation(
      useInternal ? internal.lessons.internalSaveCheckpoint : api.lessons.saveCheckpoint,
      { id: lessonId, ...args },
    ) as Promise<void>;
  const persist = (args: Record<string, unknown>) =>
    ctx.runMutation(
      useInternal ? internal.lessons.internalPersistResult : api.lessons.persistResult,
      args,
    );
  const fix = (text: string, lang: string) =>
    ctx.runAction(
      useInternal ? internal.ai.internalFixPunctuation : api.ai.fixPunctuation,
      { text, lang },
    ) as Promise<{ text: string }>;
  const genBlock = (sentences: string[], targetLang: string, nativeLang: string) =>
    ctx.runAction(
      useInternal ? internal.ai.internalGenerateBlock : api.ai.generateBlock,
      { sentences, targetLang, nativeLang },
    ) as Promise<{ raw: string }>;
  const genSummary = (fullText: string, nativeLang: string) =>
    ctx.runAction(
      useInternal ? internal.ai.internalGenerateSummary : api.ai.generateSummary,
      { fullText, nativeLang },
    ) as Promise<{ summary: string }>;
  // Time-mapping refetch: browser runs use the auth-checked action; server-queue
  // runs MUST use the internal variant — the public one throws without user
  // identity, which would kill video sync for every queued lesson.
  const fetchSegs = (url: string) =>
    ctx.runAction(
      useInternal ? internal.youtube.internalFetchTranscript : api.youtube.fetchTranscript,
      { url },
    ) as Promise<{ status: string; segments?: { text: string; offset: number }[] }>;

  const lesson = await get<{
    targetLang: string;
    nativeLang: string;
    status: string;
    rawTranscript?: string;
    videoId?: string;
    checkpoint?: Checkpoint;
  }>({ id: lessonId });
  if (!lesson) throw new Error("Aula não encontrada.");
  if (lesson.status === "ready") return { done: true };
  const raw = lesson.rawTranscript ?? "";
  if (!raw.trim()) throw new Error("Transcrição vazia.");

  const retryOnce = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/(chave|não configurada)/i.test(msg)) throw e; // config error: no point retrying
      if (/429|quota| Limite gratuito/i.test(msg)) throw new RateLimitError(msg);
      await patchProgress(0, `${label} — tentando novamente…`);
      return await fn();
    }
  };

  // ---- Stage 1: punctuation restoration in ~320-word chunks (resumable) ----
  const chunks = chunkWords(raw);
  const cp = lesson.checkpoint ?? {};
  let fixedChunks = cp.fixedChunks ? [...cp.fixedChunks] : [];
  let done = 0;
  const total = chunks.length + 2;

  for (let i = fixedChunks.length; i < chunks.length; i++) {
    if (outOfTime()) {
      await saveCheckpoint({ fixedChunks });
      return { done: false };
    }
    const chunk = chunks[i];
    if (looksPunctuated(chunk)) {
      fixedChunks.push(chunk);
    } else {
      await patchProgress(done, `Restaurando pontuação (${fixedChunks.length + 1}/${chunks.length})…`);
      const { text } = await retryOnce(() => fix(chunk, lesson.targetLang), "Falha de rede na IA");
      fixedChunks.push(text);
    }
    done += 1;
    // Checkpoint per AI call: a timeout loses at most one call of work.
    await saveCheckpoint({ fixedChunks });
  }

  const corrected = fixedChunks.join(" ");

  // ---- Stage 2: split into sentences and group into blocks of up to 5 ----
  const sentences = splitSentences(corrected);
  if (sentences.length === 0) {
    throw new Error("Não foi possível extrair frases da transcrição.");
  }
  const blocks = chunkSentences(sentences, 5);

  // ---- Stage 3: generate lesson content per block (resumable) ----
  const parsed: LessonBlock[] = cp.blocks ? [...cp.blocks] : [];
  for (let bi = parsed.length; bi < blocks.length; bi++) {
    if (outOfTime()) {
      await saveCheckpoint({ blocks: parsed });
      return { done: false };
    }
    await patchProgress(
      done + bi,
      `Traduzindo e montando vocabulário (${bi + 1}/${blocks.length})…`,
    );
    const { raw: rawJson } = await retryOnce(
      () => genBlock(blocks[bi], lesson.targetLang, lesson.nativeLang),
      "Falha na tradução",
    );
    // Stage 3 can receive a JSON array when the AI action had to split a block.
    // Normalize every returned object into the document shape expected by the UI
    // before saving it, so a malformed/partial response cannot blank the lesson.
    const normalized = normalizeBlockResult(JSON.parse(rawJson));
    if (normalized.length === 0) throw new Error("A IA retornou um bloco vazio.");
    // A recursive AI split can return several documents for one source block.
    // Merge them into one checkpoint entry so the next loop index never skips
    // the following source block.
    parsed.push({
      sensTarget: normalized.map((block) => block.sensTarget).filter(Boolean).join(" "),
      sensNative: normalized.map((block) => block.sensNative).filter(Boolean).join(" "),
      groups: normalized.flatMap((block) => block.groups),
    });
    // Checkpoint per AI call — with the halving retry inside generateBlock this
    // can take a while, so persist before moving on.
    await saveCheckpoint({ blocks: parsed });
  }

  // ---- Stage 4: overall summary (single call, non-fatal on failure) ----
  await patchProgress(done + blocks.length, "Gerando resumo do vídeo…");
  let summary = "";
  try {
    const s = await genSummary(corrected, lesson.nativeLang);
    summary = s.summary;
  } catch {
    summary = "";
  }

  // ---- Stage 5: map sentences to video timestamps when from YouTube ----
  const allSentences = parsed.flatMap((b) => b.groups.flatMap((g) => g.sentences));
  let timeMap: { start: number; text: string }[] | undefined;
  if (lesson.videoId) {
    try {
      const t = await fetchSegs(lesson.videoId);
      if (t.status !== "ok" || !t.segments) throw new Error("captions unavailable");
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^\p{L}\p{N} ]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
      // Build the normalized caption stream with a char-index → start-time map.
      let stream = "";
      const segStartChar: number[] = [];
      const segStartSec: number[] = [];
      for (const seg of t.segments) {
        const n = norm(seg.text);
        if (!n) continue;
        if (stream && !stream.endsWith(" ")) stream += " ";
        segStartChar.push(stream.length);
        segStartSec.push(seg.offset / 1000);
        stream += n;
      }
      const findStart = (sentence: string): number | null => {
        const key = norm(sentence);
        const probe = key.slice(0, Math.min(40, key.length));
        if (!probe) return null;
        const idx = stream.indexOf(probe);
        if (idx < 0) return null;
        for (let i = segStartChar.length - 1; i >= 0; i--) {
          if (segStartChar[i] <= idx) return segStartSec[i];
        }
        return null;
      };
      const mapped = allSentences.map((s) => ({
        start: findStart(s.target) ?? 0,
        text: s.target,
      }));
      if (mapped.some((m) => m.start > 0)) timeMap = mapped;
    } catch {
      timeMap = undefined;
    }
  }

  await persist(
    timeMap
      ? { id: lessonId, blocks: parsed, summary, timeMap }
      : { id: lessonId, blocks: parsed, summary },
  );
  // Lesson finished — clear the checkpoint (persistResult sets status ready).
  await saveCheckpoint({ fixedChunks: [], blocks: [] });

  return { done: true, sentenceCount: sentences.length, blockCount: parsed.length };
}

function normalizeBlockResult(value: unknown): LessonBlock[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as {
      sensTarget?: unknown;
      sensNative?: unknown;
      groups?: unknown;
    };
    if (!Array.isArray(candidate.groups)) return [];
    const groups = candidate.groups.flatMap((group) => {
      if (!group || typeof group !== "object") return [];
      const g = group as { sentences?: unknown; vocab?: unknown };
      const sentences = Array.isArray(g.sentences)
        ? g.sentences.flatMap((sentence) => {
            if (!sentence || typeof sentence !== "object") return [];
            const s = sentence as { target?: unknown; native?: unknown };
            return typeof s.target === "string" && typeof s.native === "string"
              ? [{ target: s.target, native: s.native }]
              : [];
          })
        : [];
      const vocab = Array.isArray(g.vocab)
        ? g.vocab.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const v = entry as {
              term?: unknown;
              wordClass?: unknown;
              meanings?: unknown;
              contextNote?: unknown;
              examples?: unknown;
            };
            if (typeof v.term !== "string") return [];
            const meanings = Array.isArray(v.meanings)
              ? v.meanings.filter((meaning): meaning is string => typeof meaning === "string")
              : [];
            const examples = Array.isArray(v.examples)
              ? v.examples.flatMap((example) => {
                  if (!example || typeof example !== "object") return [];
                  const e = example as { target?: unknown; native?: unknown };
                  return typeof e.target === "string" && typeof e.native === "string"
                    ? [{ target: e.target, native: e.native }]
                    : [];
                })
              : [];
            return [{
              term: v.term,
              wordClass: typeof v.wordClass === "string" ? v.wordClass : "",
              meanings,
              contextNote: typeof v.contextNote === "string" ? v.contextNote : "",
              examples,
            }];
          })
        : [];
      return sentences.length > 0 ? [{ sentences, vocab }] : [];
    });
    return groups.length > 0
      ? [{
          sensTarget: typeof candidate.sensTarget === "string" ? candidate.sensTarget : "",
          sensNative: typeof candidate.sensNative === "string" ? candidate.sensNative : "",
          groups,
        }]
      : [];
  });
}

// Browser-triggered runs now only enqueue the server-owned pipeline. Keeping
// all generation in one scheduled action prevents duplicate AI calls when the
// user remains on the lesson page or reloads it.
export const runPipeline = action({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, { lessonId }) => {
    await requireUserId(ctx);
    await ctx.scheduler.runAfter(0, internal.pipelineQueue.runQueue, { lessonId });
    return { done: false };
  },
});
