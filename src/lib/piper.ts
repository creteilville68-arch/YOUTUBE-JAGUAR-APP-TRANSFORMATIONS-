// Piper TTS running 100% in the browser.
//
// Pipeline (same as rhasspy/piper):
//   text → espeak-ng phonemes (piper_phonemize WASM, all languages) →
//   phoneme IDs → VITS ONNX (onnxruntime-web) → Float32 → WAV
//
// - The phonemizer WASM (18 MB, embedded espeak-ng data) and each ONNX voice
//   are fetched lazily on first use; both are heavy, so this module itself is
//   dynamically imported by speech.ts to keep the main bundle small.
// - The phonemizer module is created ONCE and reused across calls (verified:
//   callMain() can be called repeatedly with different languages).
// - ONNX sessions are cached per voice so "read all" doesn't re-instantiate.
// - Voice files come from rhasspy/piper-voices (HuggingFace); the browser HTTP
//   cache stores them across visits.

import * as ort from "onnxruntime-web";

export type PiperVoiceKey = string; // e.g. "fr_FR-siwis-medium"

export type PiperVoiceInfo = {
  key: PiperVoiceKey;
  lang: string;
  speaker?: number;
  sizeMB: number;
};

export const PIPER_VOICES: PiperVoiceInfo[] = [
  { key: "fr_FR-siwis-medium", lang: "fr-FR", sizeMB: 60 },
  { key: "en_US-lessac-medium", lang: "en-US", sizeMB: 60 },
  { key: "en_US-ryan-high", lang: "en-US", sizeMB: 115 },
  { key: "es_ES-sharvard-medium", lang: "es-ES", speaker: 0, sizeMB: 73 },
  { key: "es_ES-sharvard-medium", lang: "es-ES", speaker: 1, sizeMB: 73 },
  { key: "it_IT-serena-medium", lang: "it-IT", sizeMB: 64 },
  { key: "it_IT-riccardo-x_low", lang: "it-IT", sizeMB: 27 },
  { key: "de_DE-thorsten-medium", lang: "de-DE", sizeMB: 60 },
  { key: "ru_RU-irina-medium", lang: "ru-RU", sizeMB: 60 },
  { key: "pt_BR-faber-medium", lang: "pt-BR", sizeMB: 60 },
  { key: "zh_CN-huayan-medium", lang: "zh-CN", sizeMB: 64 },
  { key: "ja_JA-hi_fi_captain-medium", lang: "ja-JP", speaker: 0, sizeMB: 73 },
  { key: "ja_JA-hi_fi_captain-medium", lang: "ja-JP", speaker: 1, sizeMB: 73 },
  { key: "ko_KR-kss-medium", lang: "ko-KR", sizeMB: 60 },
];

export function piperVoicesFor(lang: string): PiperVoiceInfo[] {
  return PIPER_VOICES.filter((v) => v.lang === lang);
}

// Human-friendly label: "fr_FR-siwis-medium" → "Siwis"; speakers get A/B.
export function piperVoiceLabel(key: PiperVoiceKey, speaker?: number): string {
  const name = key.split("/")[1] ?? key;
  const pretty = name
    .replace(/^[a-z]{2}_[A-Z]{2}-/, "")
    .replace(/-(medium|high|low|x_low)$/, "");
  const cap = pretty.charAt(0).toUpperCase() + pretty.slice(1);
  if (speaker !== undefined) return `${cap} ${speaker === 0 ? "A" : "B"}`;
  return cap;
}

// espeak voice id from the model key: "fr_FR-…" → "fr-fr", pt → "pt-br".
function espeakVoiceFor(key: PiperVoiceKey): string {
  const m = key.match(/^([a-z]{2})_([A-Z]{2})/);
  if (!m) return "en-us";
  const [, lang, region] = m;
  const overrides: Record<string, string> = {
    en: "en-us",
    pt: "pt-br",
    ja: "ja",
    ko: "ko",
    zh: "cmn",
  };
  return overrides[lang] ?? `${lang}-${region.toLowerCase()}`;
}

type VoiceState =
  | { status: "idle" }
  | { status: "downloading"; received: number; total: number }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error" };

const voiceStates = new Map<PiperVoiceKey, VoiceState>();
const stateListeners = new Set<() => void>();
const sessions = new Map<string, Promise<PiperSession>>();
const synthQueues = new Map<PiperVoiceKey, Promise<unknown>>();

function sessionKey(key: PiperVoiceKey, speaker: number): string {
  return `${key}#${speaker}`;
}
function setState(key: PiperVoiceKey, s: VoiceState) {
  voiceStates.set(key, s);
  stateListeners.forEach((fn) => fn());
}

export function getPiperState(key: PiperVoiceKey): VoiceState {
  return voiceStates.get(key) ?? { status: "idle" };
}

export function onPiperState(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Phonemizer: piper_phonemize WASM (single reusable instance)
// ---------------------------------------------------------------------------

type PhonemizeModule = {
  ready: Promise<unknown>;
  callMain: (args: string[]) => void;
};

let phonemizerPromise: Promise<PhonemizeModule> | null = null;
let activePrintLines: string[] | null = null;
let phonemizeQueue: Promise<unknown> = Promise.resolve();

function getPhonemizer(): Promise<PhonemizeModule> {
  if (!phonemizerPromise) {
    phonemizerPromise = createPhonemizer();
  }
  return phonemizerPromise;
}

// The espeak-ng data (18 MB) + wasm runtime live on the package CDN (same
// setup as @diffusionstudio/vits-web). Cached by the browser after first use.
const PHONEMIZE_CDN =
  "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/";

function createPhonemizer(): Promise<PhonemizeModule> {
  return (async () => {
    const { default: createPiperPhonemize } = await import(
      "@diffusionstudio/piper-wasm/build/piper_phonemize.js"
    );
    const mod = (await createPiperPhonemize({
      print: (s: string) => activePrintLines?.push(s),
      printErr: () => {},
      noInitialRun: true,
      locateFile: (url: string) => `${PHONEMIZE_CDN}${url}`,
    })) as PhonemizeModule;
    return mod;
  })();
}

// Calls the phonemizer for one language + batch of texts. Serialized per call:
// the WASM runtime communicates via stdout, so calls must not interleave.
async function phonemizeBatch(
  espeakVoice: string,
  texts: string[],
): Promise<number[][]> {
  const run = async () => {
    const mod = await getPhonemizer();
    const lines: string[] = [];
    activePrintLines = lines;
    try {
      mod.callMain([
        "-l",
        espeakVoice,
        "--input",
        JSON.stringify(texts.map((text) => ({ text }))),
        "--espeak_data",
        "/espeak-ng-data",
      ]);
    } finally {
      activePrintLines = null;
    }
    if (lines.length !== texts.length) {
      throw new Error(
        `Fonemizador devolveu ${lines.length} linhas para ${texts.length} textos`,
      );
    }
    return lines.map((l) => JSON.parse(l).phoneme_ids as number[]);
  };
  const next = phonemizeQueue.catch(() => undefined).then(run);
  phonemizeQueue = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// ONNX voice sessions
// ---------------------------------------------------------------------------

type VoiceConfig = {
  num_speakers: number;
  speaker_id_map: Record<string, number>;
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  audio: { sample_rate: number };
};

class PiperSession {
  constructor(
    private session: ort.InferenceSession,
    private config: VoiceConfig,
    private espeakVoice: string,
    public readonly speaker: number,
  ) {}

  get sampleRate(): number {
    return this.config.audio.sample_rate;
  }

  async synthesize(text: string, speed = 1): Promise<Float32Array> {
    const [ids] = await phonemizeBatch(this.espeakVoice, [text]);
    const scales = this.config.inference;
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [
        1,
        ids.length,
      ]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor(
        "float32",
        Float32Array.from([scales.noise_scale, scales.length_scale / (speed || 1), scales.noise_w]),
        [3],
      ),
    };
    if ((this.config.num_speakers ?? 1) > 1 || Object.keys(this.config.speaker_id_map ?? {}).length > 0) {
      feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(this.speaker)]), [1]);
    }
    const results = await this.session.run(feeds);
    const out = results.output ?? Object.values(results)[0];
    return new Float32Array(out.data as Float32Array);
  }
}

const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

// "fr_FR-siwis-medium" → "…/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"
function hfUrls(key: PiperVoiceKey): { model: string; config: string } {
  const m = key.match(/^([a-z]{2})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/);
  if (!m) throw new Error(`Formato de voz Piper inválido: ${key}`);
  const [, lang, region, name, quality] = m;
  const base = `${HF_BASE}/${lang}/${lang}_${region}/${name}/${quality}`;
  return { model: `${base}/${key}.onnx`, config: `${base}/${key}.onnx.json` };
}

async function downloadWithProgress(
  url: string,
  onProgress: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged.buffer;
}

function getSession(key: PiperVoiceKey, speaker: number): Promise<PiperSession> {
  const cacheKey = sessionKey(key, speaker);
  const existing = sessions.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const { model, config } = hfUrls(key);
    setState(key, { status: "downloading", received: 0, total: 0 });

    const cfgPromise = downloadWithProgress(config, () => {}).then((buf) =>
      JSON.parse(new TextDecoder().decode(buf)),
    );
    const modelBuf = await downloadWithProgress(model, (received, total) =>
      setState(key, { status: "downloading", received, total }),
    );
    setState(key, { status: "loading" });
    const voiceConfig: VoiceConfig = await cfgPromise;
    const session = await ort.InferenceSession.create(modelBuf, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    const ps = new PiperSession(
      session,
      voiceConfig,
      espeakVoiceFor(key),
      speaker,
    );
    setState(key, { status: "ready" });
    return ps;
  })();

  promise.catch(() => setState(key, { status: "error" }));
  sessions.set(cacheKey, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Synthesizes one text to WAV base64. Calls for the same voice are serialized
// (ONNX wasm is single-threaded here; queuing keeps sequences glitch-free).
export async function piperSynthesize(args: {
  voiceKey: PiperVoiceKey;
  speaker?: number;
  text: string;
  speed?: number;
}): Promise<{ audio: string; mimeType: "audio/wav" }> {
  const speaker = args.speaker ?? 0;
  const run = async () => {
    const sess = await getSession(args.voiceKey, speaker);
    const samples = await sess.synthesize(args.text, args.speed ?? 1);
    const wav = floatToWav(samples, sess.sampleRate);
    const bytes = new Uint8Array(wav);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { audio: btoa(binary), mimeType: "audio/wav" as const };
  };
  const prev = synthQueues.get(args.voiceKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  synthQueues.set(
    args.voiceKey,
    next.catch(() => undefined),
  );
  return next;
}

function floatToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
