// Audio playback for the app — unified engine chain with user-selectable
// groups:
//
//   auto    → best available: Kokoro → Piper → Gemini → browser voice
//   piper   → Piper voices in the browser (native per-language accents)
//   kokoro  → Kokoro-82M voices in the browser
//   gemini  → server-side Gemini TTS (covers languages the others don't)
//   browser → the device's Web Speech voices
//
// Both Piper and Kokoro run 100% client-side (ONNX/WASM), download their
// models lazily on first use and cache them. "Ouvir tudo" plays every
// sentence at the same deterministic pace (playbackRate + preservesPitch).
//
// Call sites keep using speak()/stopSpeaking()/speakSequence() unchanged.
// The Gemini synthesizer is wired by the app shell via setNeuralSynthesizer().
import {
  kokoroSynthesize,
  kokoroSupported,
  getKokoroState,
  onKokoroState,
  type KokoroGender,
} from "./kokoro";

export type NeuralResult = { audio: string; mimeType: string };
export type NeuralVoice = "female" | "male";
export type NeuralSynthesizer = (args: {
  text: string;
  lang: string;
  voice?: NeuralVoice;
}) => Promise<NeuralResult>;

// Piper is loaded dynamically — heavy WASM + per-voice models.
type PiperModule = typeof import("./piper");
let piperModule: Promise<PiperModule> | null = null;
function getPiper(): Promise<PiperModule> {
  if (!piperModule) piperModule = import("./piper");
  return piperModule;
}

let neural: NeuralSynthesizer | null = null;

export function setNeuralSynthesizer(fn: NeuralSynthesizer | null) {
  neural = fn;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ---------------------------------------------------------------------------
// Preferences (persisted in localStorage)
// ---------------------------------------------------------------------------

export type EnginePref = "auto" | "piper" | "kokoro" | "gemini" | "browser";

export const PIPER_PREF = "pv_tts_piper_voice"; // per-lang voice key choice
export const KOKORO_PREF = "pv_tts_kokoro_voice"; // "female" | "male"

function getPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function setPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode — preference just won't persist
  }
}

export function enginePref(): EnginePref {
  const v = getPref("pv_tts_engine", "");
  if (
    (["auto", "piper", "kokoro", "gemini", "browser"] as const).includes(
      v as EnginePref,
    )
  ) {
    return v as EnginePref;
  }
  // Legacy key from the pre-Piper versions (browser-voice opt-out).
  return getPref("pv_tts_mode", "") === "browser" ? "browser" : "auto";
}

export function setEnginePref(v: EnginePref) {
  setPref("pv_tts_engine", v);
}

// Piper voice override per language ("auto" = first voice for the language).
export function piperVoiceChoice(lang: string): string {
  const choice = getPref(`${PIPER_PREF}:${lang}`, "auto");
  if (choice === "auto" || choice.includes("#")) return choice;
  // Migrate the previous preference format, which stored only the model key.
  return `${choice}#0`;
}

export function setPiperVoiceChoice(lang: string, key: string, speaker = 0) {
  setPref(`${PIPER_PREF}:${lang}`, `${key}#${speaker}`);
}

// Kokoro gender preference (shared with the legacy voice selector).
export function kokoroGenderPref(): KokoroGender {
  return getPref(KOKORO_PREF, "female") === "male" ? "male" : "female";
}

export function setKokoroGenderPref(g: KokoroGender) {
  setPref(KOKORO_PREF, g);
  setPref("pv_tts_voice", g); // keep legacy key in sync
}

// ---------------------------------------------------------------------------
// Piper helpers (exposed for the settings UI)
// ---------------------------------------------------------------------------

export type PiperVoiceInfo = {
  key: string;
  speaker?: number;
  label: string;
  sizeMB: number;
};

export async function listPiperVoices(lang: string): Promise<PiperVoiceInfo[]> {
  const piper = await getPiper();
  return piper.piperVoicesFor(lang).map((v) => ({
    key: v.key,
    speaker: v.speaker,
    label: piper.piperVoiceLabel(v.key, v.speaker),
    sizeMB: v.sizeMB,
  }));
}

export type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; pct: number }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error" };

// Kokoro download state (single shared model).
export function kokoroDownloadState(): DownloadState {
  const s = getKokoroState();
  if (s.status === "downloading") {
    const pct = s.total > 0 ? Math.round((s.received / s.total) * 100) : 0;
    return { status: "downloading", pct };
  }
  return s;
}

export function onKokoroDownloadState(
  fn: (s: DownloadState) => void,
): () => void {
  return onKokoroState((s) => {
    if (s.status === "downloading") {
      const pct = s.total > 0 ? Math.round((s.received / s.total) * 100) : 0;
      fn({ status: "downloading", pct });
    } else {
      fn(s);
    }
  });
}

export async function kokoroVoicesFor(
  lang: string,
): Promise<{ id: string; label: string; gender: KokoroGender }[]> {
  const map: Record<
    string,
    { id: string; label: string; gender: KokoroGender }[]
  > = {
    "en-US": [
      { id: "af_heart", label: "Heart (feminina)", gender: "female" },
      { id: "am_michael", label: "Michael (masculina)", gender: "male" },
    ],
    "fr-FR": [{ id: "ff_siwis", label: "Siwis (feminina)", gender: "female" }],
    "es-ES": [
      { id: "ef_dora", label: "Dora (feminina)", gender: "female" },
      { id: "em_alex", label: "Alex (masculina)", gender: "male" },
    ],
    "it-IT": [
      { id: "if_sara", label: "Sara (feminina)", gender: "female" },
      { id: "im_nicola", label: "Nicola (masculina)", gender: "male" },
    ],
    "pt-BR": [
      { id: "pf_dora", label: "Dora (feminina)", gender: "female" },
      { id: "pm_alex", label: "Alex (masculina)", gender: "male" },
    ],
    "ja-JP": [
      { id: "jf_alpha", label: "Alpha (feminina)", gender: "female" },
      { id: "jm_kumo", label: "Kumo (masculina)", gender: "male" },
    ],
  };
  return map[lang] ?? [];
}

// Plays a short sample with a SPECIFIC voice (settings panel preview). The
// preview always uses natural speed and does not touch the sequence state.
export async function previewVoice(args: {
  engine: "piper" | "kokoro";
  lang: string;
  text: string;
  piperKey?: string;
  speaker?: number;
  gender?: KokoroGender;
}): Promise<void> {
  stopNeural();
  window.speechSynthesis?.cancel();
  let dataUrl: string | undefined;
  if (args.engine === "piper" && args.piperKey) {
    const key = `pv|p|${args.piperKey}|${args.speaker ?? 0}|${args.text}`;
    dataUrl = cache.get(key);
    if (!dataUrl) {
      const piper = await getPiper();
      const r = await piper.piperSynthesize({
        voiceKey: args.piperKey,
        speaker: args.speaker,
        text: args.text,
      });
      dataUrl = `data:${r.mimeType};base64,${r.audio}`;
      remember(key, dataUrl);
    }
  } else if (args.engine === "kokoro") {
    const gender = args.gender ?? kokoroGenderPref();
    const key = `pv|k|${gender}|${args.text}`;
    dataUrl = cache.get(key);
    if (!dataUrl) {
      const r = await kokoroSynthesize({ text: args.text, lang: args.lang, gender });
      dataUrl = `data:${r.mimeType};base64,${r.audio}`;
      remember(key, dataUrl);
    }
  }
  if (dataUrl) await playDataUrl(dataUrl, 1);
}

// ---------------------------------------------------------------------------
// Engine resolution — which engine actually speaks a language
// ---------------------------------------------------------------------------

export type EngineChoice =
  | "kokoro"
  | "piper"
  | "gemini"
  | "browser"
  | "none";

function kokoroGenderSupports(lang: string, g: KokoroGender): boolean {
  return kokoroSupported(lang, g);
}

// Which engine will speak this language right now (no downloads triggered).
export function engineFor(lang: string): EngineChoice {
  const pref = enginePref();
  if (pref === "browser") return speechSupported() ? "browser" : "none";
  if (pref === "gemini") return neural ? "gemini" : speechSupported() ? "browser" : "none";
  if (pref === "piper") {
    return PIPER_LANGS.has(lang) ? "piper" : neural ? "gemini" : speechSupported() ? "browser" : "none";
  }
  if (pref === "kokoro") {
    return kokoroGenderSupports(lang, kokoroGenderPref())
      ? "kokoro"
      : neural
        ? "gemini"
        : "none";
  }
  // auto: Kokoro → Piper → Gemini → browser
  if (kokoroGenderSupports(lang, kokoroGenderPref())) return "kokoro";
  if (PIPER_LANGS.has(lang)) return "piper";
  if (neural) return "gemini";
  return speechSupported() ? "browser" : "none";
}

// Does the engine group have any voice for this language at all?
export function engineGroupSupports(lang: string): {
  piper: boolean;
  kokoro: boolean;
  gemini: boolean;
  browser: boolean;
} {
  return {
    piper: PIPER_LANGS.has(lang),
    kokoro: kokoroSupported(lang, "female") || kokoroSupported(lang, "male"),
    gemini: true,
    browser: speechSupported(),
  };
}

// Languages Piper covers (used for the UI before the module is loaded).
const PIPER_LANGS = new Set([
  "fr-FR",
  "en-US",
  "es-ES",
  "it-IT",
  "de-DE",
  "ru-RU",
  "pt-BR",
  "zh-CN",
  "ja-JP",
  "ko-KR",
]);

export function engineLabel(lang?: string): string {
  const engine = lang ? engineFor(lang) : enginePref() === "browser" ? "browser" : "kokoro";
  switch (engine) {
    case "kokoro":
      return "Voz neural nativa (no seu dispositivo)";
    case "piper":
      return "Voz Piper (no seu dispositivo)";
    case "gemini":
      return "Voz neural (Gemini)";
    case "browser":
      return "Voz do navegador";
    default:
      return "Sem áudio neste navegador";
  }
}

// ---------------------------------------------------------------------------
// Playback core
// ---------------------------------------------------------------------------

// In-memory cache of synthesized audio (data URLs) — repeated clicks on the
// same sentence play instantly and don't redo work.
const cache = new Map<string, string>();
const MAX_CACHE = 120;

function remember(key: string, dataUrl: string) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, dataUrl);
}

let currentAudio: HTMLAudioElement | null = null;
let seqAbort = false;
let seqRunning = false;

// Deterministic pacing: speed is applied at playback (uniform for every
// sentence), with pitch preserved so slower study speed keeps the timbre.
function applyRate(audio: HTMLAudioElement, rate: number) {
  audio.playbackRate = rate;
  const withPitch = audio as HTMLAudioElement & { preservesPitch?: boolean };
  if ("preservesPitch" in withPitch) withPitch.preservesPitch = true;
  type VendorAudio = HTMLAudioElement & {
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  const va = audio as VendorAudio;
  if ("webkitPreservesPitch" in va) va.webkitPreservesPitch = true;
  if ("mozPreservesPitch" in va) va.mozPreservesPitch = true;
}

function stopNeural() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

function pickVoice(langCode: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === langCode) ??
    voices.find((v) => v.lang.replace("_", "-") === langCode) ??
    voices.find((v) => v.lang.startsWith(langCode.split("-")[0]))
  );
}

function playDataUrl(dataUrl: string, rate: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(dataUrl);
    currentAudio = audio;
    applyRate(audio, rate);
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error("audio playback error"));
    };
    void audio.play().catch(reject);
  });
}

async function playKokoro(
  text: string,
  langCode: string,
  rate: number,
): Promise<boolean> {
  const gender = kokoroGenderPref();
  if (!kokoroSupported(langCode, gender)) return false;
  try {
    const key = `k|${gender}|${rate < 0.95 ? "slow" : "norm"}|${langCode}|${text}`;
    let dataUrl = cache.get(key);
    if (!dataUrl) {
      const r = await kokoroSynthesize({ text, lang: langCode, gender });
      dataUrl = `data:${r.mimeType};base64,${r.audio}`;
      remember(key, dataUrl);
    }
    await playDataUrl(dataUrl, rate);
    return true;
  } catch (e) {
    if (seqAbort) return true;
    console.warn("Kokoro falhou — tentando a próxima voz.", e);
    return false;
  }
}

async function playPiper(
  text: string,
  langCode: string,
  rate: number,
): Promise<boolean> {
  try {
    const piper = await getPiper();
    const voices = piper.piperVoicesFor(langCode);
    if (voices.length === 0) return false;
    const choice = piperVoiceChoice(langCode);
    const [choiceKey, choiceSpeaker] = choice.split("#");
    const picked = voices.find(
      (v) => v.key === choiceKey && (v.speaker ?? 0) === Number(choiceSpeaker),
    ) ?? voices[0];
    const key = `p|${picked.key}|${picked.speaker ?? 0}|${rate < 0.95 ? "slow" : "norm"}|${langCode}|${text}`;
    let dataUrl = cache.get(key);
    if (!dataUrl) {
      const r = await piper.piperSynthesize({
        voiceKey: picked.key,
        speaker: picked.speaker,
        text,
        speed: 1,
      });
      dataUrl = `data:${r.mimeType};base64,${r.audio}`;
      remember(key, dataUrl);
    }
    await playDataUrl(dataUrl, rate);
    return true;
  } catch (e) {
    if (seqAbort) return true;
    console.warn("Piper falhou — tentando a próxima voz.", e);
    return false;
  }
}

async function playGemini(
  text: string,
  langCode: string,
  rate: number,
): Promise<boolean> {
  if (!neural) return false;
  try {
    const key = `g|${rate < 0.95 ? "slow" : "norm"}|${langCode}|${text}`;
    let dataUrl = cache.get(key);
    if (!dataUrl) {
      const r = await neural({ text, lang: langCode });
      dataUrl = `data:${r.mimeType};base64,${r.audio}`;
      remember(key, dataUrl);
    }
    await playDataUrl(dataUrl, rate);
    return true;
  } catch (e) {
    if (seqAbort) return true;
    console.warn("Voz Gemini falhou — usando a voz do navegador.", e);
    return false;
  }
}

async function playBrowser(text: string, langCode: string, rate: number) {
  if (speechSupported()) {
    await new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = langCode;
      utter.rate = rate;
      const voice = pickVoice(langCode);
      if (voice) utter.voice = voice;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }
}

async function playOne(
  text: string,
  langCode: string,
  rate: number,
): Promise<void> {
  const pref = enginePref();
  if (pref !== "browser") {
    if (pref === "kokoro" || pref === "auto") {
      if (await playKokoro(text, langCode, rate)) return;
      if (seqAbort) return;
    }
    if (pref === "piper" || pref === "auto") {
      if (await playPiper(text, langCode, rate)) return;
      if (seqAbort) return;
    }
    if (pref === "gemini" || pref === "auto" || pref === "piper" || pref === "kokoro") {
      if (await playGemini(text, langCode, rate)) return;
      if (seqAbort) return;
    }
  }
  await playBrowser(text, langCode, rate);
}

export function speak(text: string, langCode: string, rate = 0.95) {
  const clean = text?.trim();
  if (!clean) return;
  seqAbort = true; // cancel any running sequence
  window.speechSynthesis?.cancel();
  stopNeural();
  void playOne(clean, langCode, rate);
}

// Plays sentences one after another at a UNIFORM rate (default 0.9,
// pitch-preserved). onIndex reports the current sentence for highlighting.
// stopSpeaking() cancels.
export const SEQ_RATE = 0.9;

export async function speakSequence(
  texts: string[],
  langCode: string,
  rate = SEQ_RATE,
  onIndex?: (i: number) => void,
): Promise<void> {
  seqAbort = true; // stop any previous sequence
  window.speechSynthesis?.cancel();
  stopNeural();
  await new Promise((r) => setTimeout(r, 60));
  seqAbort = false;
  seqRunning = true;
  try {
    for (let i = 0; i < texts.length; i++) {
      if (seqAbort) return;
      onIndex?.(i);
      await playOne(texts[i], langCode, rate);
      if (seqAbort) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    seqRunning = false;
    onIndex?.(-1);
  }
}

export function stopSpeaking() {
  seqAbort = true;
  if (speechSupported()) window.speechSynthesis.cancel();
  stopNeural();
}

// Preload voices (Chrome loads them asynchronously).
export function warmVoices() {
  if (speechSupported()) window.speechSynthesis.getVoices();
}

// Test-only escape hatch.
export function isSequenceRunning(): boolean {
  return seqRunning;
}
