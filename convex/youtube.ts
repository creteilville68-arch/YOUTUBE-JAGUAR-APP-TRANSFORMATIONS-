"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { YoutubeTranscript } from "youtube-transcript";
import { requireUserId } from "./authHelpers";

export function parseVideoId(url: string): string | null {
  const raw = url.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (u.hostname.includes("youtube.com")) {
      const vParam = u.searchParams.get("v");
      if (vParam) return vParam;
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

type Segment = { text: string; offset: number };

type TranscriptResult = {
  status: "ok" | "unavailable";
  reason?: string;
  text?: string;
  segments?: Segment[];
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
};

// Shared core — called by the public (auth-checked) action and by the
// scheduler-only internal variants (server queue runs with no user identity).
async function fetchTranscriptCore(url: string): Promise<TranscriptResult> {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error("URL do YouTube inválida.");
  }

  // Metadata via oEmbed works even when captions are blocked.
  let title = "";
  let author = "";
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (oembed.ok) {
      const meta = (await oembed.json()) as { title?: string; author_name?: string };
      title = meta.title ?? "";
      author = meta.author_name ?? "";
    }
  } catch {
    // metadata is optional
  }

  const meta = {
    videoId,
    title: title || "Aula do YouTube",
    author,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  let segments: Segment[] | null = null;
  let lastError = "";

  // Path 1 (free): direct fetch — works for most videos.
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    const mapped = raw.map((s) => ({
      text: s.text,
      offset: (s as unknown as { offset?: number }).offset ?? 0,
    }));
    if (mapped.length > 0) segments = mapped;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  // Path 2: Supadata transcript API — routes through residential IPs,
  // bypassing YouTube's datacenter-IP bot wall, with Whisper AI fallback
  // for videos with no captions at all. Used only when path 1 fails,
  // so free credits are consumed only when actually needed.
  if (!segments && process.env.SUPADATA_API_KEY) {
    try {
      const res = await fetch(
        `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`,
        )}`,
        { headers: { "x-api-key": process.env.SUPADATA_API_KEY ?? "" }, signal: AbortSignal.timeout(120_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          content?: { text: string; offset: number }[];
        };
        const mapped = (data.content ?? [])
          .filter((c) => c.text)
          .map((c) => ({ text: c.text, offset: c.offset ?? 0 }));
        if (mapped.length > 0) segments = mapped;
      } else {
        lastError = `supadata ${res.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!segments) {
    const msg = lastError;
    const reason = /429|too many/i.test(msg)
      ? "O YouTube está limitando as requisições agora — tente de novo em alguns minutos."
      : /unavailable|not exist|private|removed/i.test(msg)
        ? "O vídeo está indisponível, privado ou foi removido."
        : process.env.SUPADATA_API_KEY
          ? "Não foi possível obter a transcrição deste vídeo (nem via serviço de fallback)."
          : "O YouTube bloqueou o acesso automático às legendas deste vídeo. Para desbloquear a importação automática, configure a chave SUPADATA_API_KEY (grátis em supadata.ai) nas configurações do projeto.";
    return { status: "unavailable", reason, ...meta };
  }

  return {
    status: "ok",
    text: segments.map((s) => s.text).join(" "),
    segments,
    ...meta,
  };
}

// Browser-triggered import (auth-checked).
export const fetchTranscript = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    await requireUserId(ctx);
    return await fetchTranscriptCore(url);
  },
});

// Scheduler-only variant: the server queue calls this while chaining the
// pipeline with no user identity attached.
export const internalFetchTranscript = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    return await fetchTranscriptCore(url);
  },
});

export const setProgress = action({
  args: {
    lessonId: v.id("lessons"),
    step: v.number(),
    label: v.string(),
  },
  handler: async (ctx, { lessonId, step, label }) => {
    await requireUserId(ctx);
    await ctx.runMutation(api.lessons.patchProgress, { id: lessonId, step, label });
  },
});
