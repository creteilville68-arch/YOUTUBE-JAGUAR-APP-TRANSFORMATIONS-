"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { requireUserId } from "./authHelpers";

// "gemini-flash-latest" is a Google-maintained alias that always points at the
// newest available flash model — concrete versions get retired (2.5-flash now
// 404s for new keys) and some have very low free-tier RPM (gemini-3.6-flash: 20).
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = { text?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave da IA não configurada. Adicione GEMINI_API_KEY nas configurações do projeto (grátis em aistudio.google.com).",
    );
  }
  const url = `${API_BASE}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      // Thinking tokens count against maxOutputTokens on thinking models —
      // a tight budget gets consumed by reasoning and the JSON truncates.
      // Headroom covers thinking; minimal thinking depth always (probed: a
      // real block takes ~3s with "low" vs ~18s with default deep thinking).
      maxOutputTokens: (opts.maxTokens ?? 1000) + 4096,
      temperature: opts.json ? 0.2 : 0.3,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      thinkingConfig: { thinkingLevel: "low" },
    },
  });

  // Free tier has tight per-minute limits — back off and retry on 429/5xx
  // instead of failing the whole lesson. 3 retries: 15s, 35s, 60s.
  let res!: Response;
  for (let attempt = 0; ; attempt++) {
    // Hard timeout: a stalled connection must never hang the action until the
    // platform's 600s kill — real responses come back in <30s.
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) break;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep([15000, 35000, 60000][attempt]);
      continue;
    }
    break;
  }

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 429) {
      throw new Error("Limite gratuito da IA atingido (429). Aguarde um minuto e tente de novo.");
    }
    if (res.status === 403 || res.status === 400) {
      throw new Error(`IA rejeitou a chamada (${res.status}). Verifique a chave GEMINI_API_KEY. ${errBody.slice(0, 200)}`);
    }
    throw new Error(`Erro na IA (${res.status}): ${errBody.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
  if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    // Truncated mid-answer — callers treat this like invalid JSON and retry smaller.
    throw new Error("Resposta da IA truncada (limite de tokens). Tente novamente.");
  }
  return text;
}

function parseJson<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  return JSON.parse(s) as T;
}

export const fixPunctuation = action({
  args: { text: v.string(), lang: v.string() },
  handler: async (_ctx, { text, lang }) => {
    const system = `You restore punctuation and capitalization on a raw, unpunctuated ${lang} speech transcript. Do NOT change, add, remove, translate, or reorder any words — only insert periods, commas, question marks and exclamation marks where they naturally belong, and capitalize the start of sentences and proper nouns. Respond with ONLY the corrected text, nothing else.`;
    return { text: await callGemini(system, text, { maxTokens: 1000 }) };
  },
});

// Scheduler-only variant (same behavior; runs without user identity).
export const internalFixPunctuation = internalAction({
  args: { text: v.string(), lang: v.string() },
  handler: async (_ctx, { text, lang }) => {
    const system = `You restore punctuation and capitalization on a raw, unpunctuated ${lang} speech transcript. Do NOT change, add, remove, translate, or reorder any words — only insert periods, commas, question marks and exclamation marks where they naturally belong, and capitalize the start of sentences and proper nouns. Respond with ONLY the corrected text, nothing else.`;
    return { text: await callGemini(system, text, { maxTokens: 1000 }) };
  },
});

export const generateBlock = action({
  args: {
    sentences: v.array(v.string()),
    targetLang: v.string(),
    nativeLang: v.string(),
  },
  handler: async (_ctx, { sentences, targetLang, nativeLang }) => {
    const system = `You are a ${targetLang} teacher for ${nativeLang} speakers, specialized in listening comprehension and vocabulary. Fix obvious auto-transcription errors when you notice them. Respond ONLY with valid JSON, in the format: {"sensTarget": string (explanation of the passage in ${targetLang}), "sensNative": string (that explanation translated to ${nativeLang}), "groups": [{"sentences": [{"target": string, "native": string}], "vocab": [{"term": string, "wordClass": string, "meanings": string[], "contextNote": string, "examples": [{"target": string, "native": string}]}]}]}. Rules: each group has AT MOST 2 sentences; choose 1-2 key vocabulary words per group; if a word has multiple common meanings, list them all and explain the contextual one; generate exactly 1 example per word in this step. JSON safety: never use unescaped double quotes inside string values (prefer single quotes or guillemets), no trailing commas, no comments, no markdown fences — raw JSON only.`;

    const run = async (lines: string[]): Promise<string> => {
      const raw = await callGemini(system, lines.join("\n"), { maxTokens: 1000, json: true });
      const parsed = parseJson<{
        sensTarget?: string;
        sensNative?: string;
        groups?: unknown[];
      }>(raw);
      if (!parsed.groups || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
        throw new Error("JSON incompleto");
      }
      return JSON.stringify(parsed);
    };

    // Retry with recursive halving when the model returns truncated JSON.
    const attempt = async (lines: string[]): Promise<string> => {
      if (lines.length <= 1) return run(lines);
      try {
        return await run(lines);
      } catch (error) {
        // Only malformed/truncated JSON should trigger recursive halving.
        // Network, credential and quota errors must bubble up to the queue so
        // they can be retried with the correct policy instead of multiplying
        // expensive AI calls.
        const message = error instanceof Error ? error.message : String(error);
        if (!/(json|truncad|unexpected token|unterminated)/i.test(message)) throw error;
        const mid = Math.ceil(lines.length / 2);
        const first = await attempt(lines.slice(0, mid));
        const second = await attempt(lines.slice(mid));
        return JSON.stringify([JSON.parse(first), JSON.parse(second)]);
      }
    };

    return { raw: await attempt(sentences) };
  },
});

// Scheduler-only variant of generateBlock (shares identical logic).
export const internalGenerateBlock = internalAction({
  args: {
    sentences: v.array(v.string()),
    targetLang: v.string(),
    nativeLang: v.string(),
  },
  handler: async (_ctx, { sentences, targetLang, nativeLang }) => {
    const system = `You are a ${targetLang} teacher for ${nativeLang} speakers, specialized in listening comprehension and vocabulary. Fix obvious auto-transcription errors when you notice them. Respond ONLY with valid JSON, in the format: {"sensTarget": string (explanation of the passage in ${targetLang}), "sensNative": string (that explanation translated to ${nativeLang}), "groups": [{"sentences": [{"target": string, "native": string}], "vocab": [{"term": string, "wordClass": string, "meanings": string[], "contextNote": string, "examples": [{"target": string, "native": string}]}]}]}. Rules: each group has AT MOST 2 sentences; choose 1-2 key vocabulary words per group; if a word has multiple common meanings, list them all and explain the contextual one; generate exactly 1 example per word in this step. JSON safety: never use unescaped double quotes inside string values (prefer single quotes or guillemets), no trailing commas, no comments, no markdown fences — raw JSON only.`;

    const run = async (lines: string[]): Promise<string> => {
      const raw = await callGemini(system, lines.join("\n"), { maxTokens: 1000, json: true });
      const parsed = parseJson<{
        sensTarget?: string;
        sensNative?: string;
        groups?: unknown[];
      }>(raw);
      if (!parsed.groups || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
        throw new Error("JSON incompleto");
      }
      return JSON.stringify(parsed);
    };

    const attempt = async (lines: string[]): Promise<string> => {
      if (lines.length <= 1) return run(lines);
      try {
        return await run(lines);
      } catch (error) {
        // Only malformed/truncated JSON should trigger recursive halving.
        // Network, credential and quota errors must bubble up to the queue so
        // they can be retried with the correct policy instead of multiplying
        // expensive AI calls.
        const message = error instanceof Error ? error.message : String(error);
        if (!/(json|truncad|unexpected token|unterminated)/i.test(message)) throw error;
        const mid = Math.ceil(lines.length / 2);
        const first = await attempt(lines.slice(0, mid));
        const second = await attempt(lines.slice(mid));
        return JSON.stringify([JSON.parse(first), JSON.parse(second)]);
      }
    };

    return { raw: await attempt(sentences) };
  },
});

export const generateSummary = action({
  args: { fullText: v.string(), nativeLang: v.string() },
  handler: async (_ctx, { fullText, nativeLang }) => {
    const system = `You summarize videos in ${nativeLang}, in 3-4 lines, straight to the point: topic, tone, and what the author wants to convey or argue. Respond with ONLY the summary text.`;
    return { summary: await callGemini(system, fullText.slice(0, 8000), { maxTokens: 400 }) };
  },
});

// Scheduler-only variant of generateSummary.
export const internalGenerateSummary = internalAction({
  args: { fullText: v.string(), nativeLang: v.string() },
  handler: async (_ctx, { fullText, nativeLang }) => {
    const system = `You summarize videos in ${nativeLang}, in 3-4 lines, straight to the point: topic, tone, and what the author wants to convey or argue. Respond with ONLY the summary text.`;
    return { summary: await callGemini(system, fullText.slice(0, 8000), { maxTokens: 400 }) };
  },
});

export const lookupWord = action({
  args: {
    term: v.string(),
    contextSentence: v.optional(v.string()),
    targetLang: v.string(),
    nativeLang: v.string(),
  },
  handler: async (_ctx, { term, contextSentence, targetLang, nativeLang }) => {
    const system = `You are a ${targetLang}-${nativeLang} dictionary for learners. Respond ONLY with valid JSON: {"term": string, "wordClass": string, "meanings": string[], "contextNote": string, "examples": [{"target": string, "native": string}] with exactly 3 examples}. If a context sentence is given, use it to pick the right meaning.`;
    const user = contextSentence
      ? `Palavra: "${term}"\nContexto: "${contextSentence}"`
      : `Palavra: "${term}"`;
    const raw = await callGemini(system, user, { maxTokens: 1000, json: true });
    return { entry: parseJson(raw) };
  },
});

export const generateExamples = action({
  args: {
    term: v.string(),
    wordClass: v.optional(v.string()),
    meanings: v.array(v.string()),
    count: v.number(),
    cefr: v.string(),
    targetLang: v.string(),
    nativeLang: v.string(),
  },
  handler: async (_ctx, { term, wordClass, meanings, count, cefr, targetLang, nativeLang }) => {
    const system = `You generate example sentences in ${targetLang} for vocabulary flashcards, calibrated to a specific CEFR level, translated into ${nativeLang}. Respond ONLY with valid JSON: {"examples": [{"target": string, "native": string}]}. Generate exactly ${count} examples, one per line of thought, each using the word in a different common meaning when applicable.`;
    const user = `Palavra: "${term}"${wordClass ? ` (${wordClass})` : ""}\nSignificados: ${meanings.join("; ")}\nNível CEFR alvo: ${cefr}`;
    const raw = await callGemini(system, user, { maxTokens: 1000, json: true });
    return parseJson<{ examples: { target: string; native: string }[] }>(raw);
  },
});
