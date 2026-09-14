"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireUserId } from "./authHelpers";

// Neural TTS via the Gemini API — same key/quota ecosystem the app already uses
// for lesson generation (no extra account). Returns WAV audio (base64) that the
// browser plays directly. Google retires concrete TTS model versions over time,
// so the model is env-overridable (GEMINI_TTS_MODEL) — same policy as GEMINI_MODEL.
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Prebuilt Gemini voices — a small stable set; one warm female + one warm male.
const VOICES: Record<string, string> = {
  female: "Kore",
  male: "Puck",
};

// BCP-47 code → language name for the synthesis prompt. The TTS model follows
// the language of the surrounding prompt, so the instruction must name the
// target language explicitly and the text must be delimited — otherwise it
// anchors on the prompt language and reads e.g. French with pt-BR phonetics.
const LANG_NAMES: Record<string, string> = {
  "en-US": "English",
  "es-ES": "Spanish (Spain)",
  "fr-FR": "French (France)",
  "de-DE": "German (Germany)",
  "it-IT": "Italian (Italy)",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "zh-CN": "Mandarin Chinese",
  "pt-BR": "Brazilian Portuguese",
  "ru-RU": "Russian",
};

// PCM s16le 24kHz mono → WAV container (44-byte RIFF header).
// Gemini returns raw L16 PCM; browsers can't play it directly without a header.
// Uses ArrayBuffer/DataView: Convex V8 actions have no Node Buffer.
function pcmToWav(pcm: ArrayBuffer, sampleRate = 24000, channels = 1): ArrayBuffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const pcmBytes = pcm.byteLength;
  const out = new ArrayBuffer(44 + pcmBytes);
  const view = new DataView(out);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcmBytes, true);
  new Uint8Array(out, 44).set(new Uint8Array(pcm));
  return out;
}

export const synthesize = action({
  args: {
    text: v.string(),
    lang: v.string(), // BCP-47 of the target language, e.g. "fr-FR"
    voice: v.optional(v.union(v.literal("female"), v.literal("male"))),
    // Accepted for call-site compatibility; pacing is applied client-side via
    // playbackRate (prompt-level slowing was inconsistent across sentences).
    rate: v.optional(v.number()),
  },
  handler: async (_ctx, { text, lang, voice }) => {
    await requireUserId(_ctx);

    const clean = text.trim().slice(0, 3000);
    if (!clean) throw new Error("Texto vazio.");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Chave da IA não configurada. Adicione GEMINI_API_KEY nas configurações do projeto.",
      );
    }

    // Neutral-English instruction (the model is strongest in English) naming
    // the target language and dialect, plus a language tag around the text.
    // No speed instruction here: pacing is applied deterministically in the
    // browser via playbackRate (prompt-based slowing was inconsistent).
    const langName = LANG_NAMES[lang] ?? lang;
    const prompt = `Read the following ${langName} text aloud with a native ${langName} accent and natural ${langName} pronunciation and intonation. Say ONLY the text, with no introduction, translation, or commentary:

<text lang="${lang}">
${clean}
</text>`;

    const res = await fetch(
      `${API_BASE}/${TTS_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICES[voice ?? "female"] },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 429) {
        throw new Error(
          "Limite gratuito da IA atingido (429). Aguarde um minuto e tente de novo.",
        );
      }
      throw new Error(
        `Erro no áudio neural (${res.status}): ${errBody.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
      }[];
    };
    const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const b64 = inline?.data;
    if (!b64) throw new Error("A IA não retornou áudio. Tente novamente.");

    // The TTS model returns raw L16 PCM — wrap it in a WAV header for playback.
    const pcm = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wav = pcmToWav(pcm.buffer as ArrayBuffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < wav.byteLength; i += chunk) {
      binary += String.fromCharCode(...new Uint8Array(wav, i, Math.min(chunk, wav.byteLength - i)));
    }
    return {
      audio: btoa(binary),
      mimeType: "audio/wav",
      // Echo back what was spoken so the player can show/caption it reliably.
      text: clean,
      lang,
    };
  },
});
