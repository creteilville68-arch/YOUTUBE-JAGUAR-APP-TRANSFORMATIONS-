// Kokoro-82M TTS running 100% in the browser (ONNX via transformers.js).
// Native per-language voices — fixes the "Brazilian accent reading foreign
// text" problem at the root, with zero per-use API cost. Model (~92 MB, q8)
// downloads once on first use and is cached by the browser (Cache API).
// The library is dynamically imported so the main bundle stays small — the
// TTS engine chunk only loads when the user first plays audio.

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Voice per language+gender, chosen from hexgrad/Kokoro-82M VOICES.md grades.
// v1.0 has no German/Korean/Russian voices — those stay on the Gemini path.
const VOICE_MAP: Record<string, { female: string; male?: string }> = {
  "en-US": { female: "af_heart", male: "am_michael" },
  "fr-FR": { female: "ff_siwis" },
  "es-ES": { female: "ef_dora", male: "em_alex" },
  "it-IT": { female: "if_sara", male: "im_nicola" },
  "pt-BR": { female: "pf_dora", male: "pm_alex" },
  "ja-JP": { female: "jf_alpha", male: "jm_kumo" },
};

export type KokoroGender = "female" | "male";

export function kokoroSupported(lang: string, gender: KokoroGender): boolean {
  const entry = VOICE_MAP[lang];
  if (!entry) return false;
  return gender === "male" ? !!entry.male : true;
}

// Load state + progress so the UI can show "downloading voice…" on first use.
type LoadState =
  | { status: "idle" }
  | { status: "downloading"; received: number; total: number }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error" };
let loadState: LoadState = { status: "idle" };
const listeners = new Set<(s: LoadState) => void>();

function setState(s: LoadState) {
  loadState = s;
  listeners.forEach((fn) => fn(s));
}

export function getKokoroState(): LoadState {
  return loadState;
}

export function onKokoroState(fn: (s: LoadState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type KokoroTTSInstance = Awaited<
  ReturnType<typeof import("kokoro-js").KokoroTTS.from_pretrained>
>;
let instancePromise: Promise<KokoroTTSInstance> | null = null;

function getInstance(): Promise<KokoroTTSInstance> {
  if (!instancePromise) {
    setState({ status: "loading" });
    instancePromise = import("kokoro-js")
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8", // 92 MB — best compatibility (wasm), one-time download
          device: "wasm", // WebGPU not universal on phones; wasm always works
          progress_callback: (p: {
            status?: string;
            loaded?: number;
            total?: number;
          }) => {
            if (p?.status === "progress" && typeof p.total === "number") {
              setState({
                status: "downloading",
                received: p.loaded ?? 0,
                total: p.total,
              });
            }
          },
        }),
      )
      .then((tts) => {
        setState({ status: "ready" });
        return tts;
      })
      .catch((e) => {
        instancePromise = null;
        setState({ status: "error" });
        throw e;
      });
  }
  return instancePromise;
}

// Float32 [-1, 1] samples → 16-bit PCM WAV (RIFF) container.
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

export async function kokoroSynthesize(args: {
  text: string;
  lang: string;
  gender: KokoroGender;
  speed?: number; // model-native, deterministic pacing
}): Promise<{ audio: string; mimeType: "audio/wav" }> {
  const entry = VOICE_MAP[args.lang];
  if (!entry) throw new Error(`Kokoro não suporta ${args.lang}`);
  const voice = args.gender === "male" ? (entry.male ?? entry.female) : entry.female;

  const tts = await getInstance();
  const out = await tts.generate(args.text, {
    voice: voice as keyof typeof tts.voices,
    speed: args.speed ?? 1,
  });
  const wav = floatToWav(out.audio as Float32Array, out.sampling_rate);

  // ArrayBuffer → base64 in chunks (avoid call-stack limits).
  const bytes = new Uint8Array(wav);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { audio: btoa(binary), mimeType: "audio/wav" };
}
