// Unified voice settings panel — one collapsible control that groups every
// audio engine and its voices, replacing scattered selects across the page.
//
//   [ 🎙️ Voz · Piper · Siwis          trocar ▾ ]   ← closed by default
//
//   Grupos:  (Auto) (Piper) (Kokoro) (Gemini) (Navegador)
//   Piper:    ○ Siwis  60 MB  ✓  ▶
//             ○ (outras vozes do idioma da aula)
//   Kokoro:   ○ Siwis (feminina)  ▶
//   …
import { useEffect, useState } from "react";
import {
  engineFor,
  engineGroupSupports,
  enginePref,
  setEnginePref,
  piperVoiceChoice,
  setPiperVoiceChoice,
  kokoroGenderPref,
  setKokoroGenderPref,
  kokoroDownloadState,
  onKokoroDownloadState,
  listPiperVoices,
  kokoroVoicesFor,
  previewVoice,
  speechSupported,
  type EnginePref,
  type PiperVoiceInfo,
  type DownloadState,
} from "../lib/speech";
import type { KokoroGender } from "../lib/kokoro";

type Props = { langCode: string };

const GROUPS: { id: EnginePref; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Escolhe a melhor voz disponível para cada idioma." },
  { id: "piper", label: "Piper", hint: "Vozes locais — sotaque nativo, funciona offline." },
  { id: "kokoro", label: "Kokoro", hint: "Vozes locais de alta qualidade (modelo de 92 MB)." },
  { id: "gemini", label: "Gemini", hint: "Voz neural gerada na nuvem." },
  { id: "browser", label: "Navegador", hint: "Voz instalada no seu dispositivo (qualidade varia)." },
];

const SAMPLES: Record<string, string> = {
  "fr-FR": "Bonjour ! Voici un aperçu de cette voix.",
  "en-US": "Hello! This is a preview of this voice.",
  "es-ES": "¡Hola! Esta es una muestra de esta voz.",
  "it-IT": "Ciao! Questa è un'anteprima di questa voce.",
  "de-DE": "Hallo! Das ist eine Vorschau dieser Stimme.",
  "ru-RU": "Привет! Это пример этого голоса.",
  "pt-BR": "Olá! Esta é uma amostra desta voz.",
  "ja-JP": "こんにちは！この声のサンプルです。",
  "zh-CN": "你好！这是这个声音的示例。",
  "ko-KR": "안녕하세요! 이 목소리의 샘플입니다.",
};

function dlText(s: DownloadState): string {
  switch (s.status) {
    case "downloading":
      return `baixando ${s.pct}%`;
    case "loading":
      return "preparando…";
    case "ready":
      return "✓";
    case "error":
      return "falhou";
    default:
      return "";
  }
}

export function VoiceSettings({ langCode }: Props) {
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<EnginePref>(enginePref());
  const [piperVoices, setPiperVoices] = useState<PiperVoiceInfo[] | null>(null);
  const [piperChoice, setPiperChoice] = useState(piperVoiceChoice(langCode));
  const [kokoroVoices, setKokoroVoices] = useState<
    { id: string; label: string; gender: KokoroGender }[]
  >([]);
  const [kokoroGender, setKokoroGender] = useState<KokoroGender>(kokoroGenderPref());
  const [piperStates, setPiperStates] = useState<Record<string, DownloadState>>({});
  const [kokoroDl, setKokoroDl] = useState<DownloadState>(kokoroDownloadState());
  const [previewing, setPreviewing] = useState<string | null>(null);

  const support = engineGroupSupports(langCode);

  // Kokoro download state subscription (cheap, module is tiny).
  useEffect(() => onKokoroDownloadState(setKokoroDl), []);

  // Piper state subscription — the piper module is heavy, so we only touch it
  // while the panel is open (and voice lists are needed anyway).
  useEffect(() => {
    if (!open) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const piper = await import("../lib/piper");
      if (!active) return;
      const refresh = () => {
        const map: Record<string, DownloadState> = {};
        for (const v of piper.PIPER_VOICES) {
          const s = piper.getPiperState(v.key);
          map[`${v.key}#${v.speaker ?? 0}`] =
            s.status === "downloading"
              ? {
                  status: "downloading",
                  pct: s.total > 0 ? Math.round((s.received / s.total) * 100) : 0,
                }
              : s;
        }
        setPiperStates(map);
      };
      refresh();
      unsubscribe = piper.onPiperState(refresh);
    })();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [open]);

  // Reset language-specific voice lists when navigating between lesson languages.
  useEffect(() => {
    setPiperVoices(null);
    setPiperChoice(piperVoiceChoice(langCode));
    setKokoroVoices([]);
  }, [langCode]);

  // Voice lists for the lesson's language (loaded when first opened).
  useEffect(() => {
    if (!open || piperVoices) return;
    let active = true;
    void listPiperVoices(langCode)
      .then((v) => active && setPiperVoices(v))
      .catch(() => active && setPiperVoices([]));
    void kokoroVoicesFor(langCode).then((v) => active && setKokoroVoices(v));
    return () => {
      active = false;
    };
  }, [open, langCode, piperVoices]);

  const selectGroup = (id: EnginePref) => {
    setEngine(id);
    setEnginePref(id);
  };

  const choosePiperVoice = (info: PiperVoiceInfo) => {
    setPiperChoice(`${info.key}#${info.speaker ?? 0}`);
    setPiperVoiceChoice(langCode, info.key, info.speaker ?? 0);
    selectGroup("piper");
  };

  const chooseKokoroVoice = (g: KokoroGender) => {
    setKokoroGender(g);
    setKokoroGenderPref(g);
    selectGroup("kokoro");
  };

  const preview = (
    id: string,
    args: Omit<Parameters<typeof previewVoice>[0], "text">,
  ) => {
    setPreviewing(id);
    void previewVoice({ ...args, text: SAMPLES[langCode] ?? "Olá!" }).finally(() =>
      setPreviewing(null),
    );
  };

  const activeEngine = engineFor(langCode);
  const summary =
    engine === "auto"
      ? `Auto · ${
          activeEngine === "none" ? "sem áudio" : GROUPS.find((g) => g.id === activeEngine)?.label ?? activeEngine
        }`
      : GROUPS.find((g) => g.id === engine)?.label ?? engine;

  return (
    <div className="no-print rounded-xl border border-paper-300 bg-paper-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-ink-700">
          🎙️ Voz · {summary}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          {open ? "fechar ▴" : "trocar ▾"}
        </span>
      </button>

      {open && (
        <div className="border-t border-paper-200 px-3 pb-3 pt-2">
          {/* Engine groups */}
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => {
              const supported =
                g.id === "piper" ? support.piper : g.id === "kokoro" ? support.kokoro : g.id === "browser" ? support.browser : true;
              const selected = engine === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => selectGroup(g.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-terracotta-500 bg-terracotta-500 text-white"
                      : "border-paper-300 bg-card text-ink-500 hover:border-terracotta-400 hover:text-terracotta-600"
                  } ${supported ? "" : "opacity-40"}`}
                  title={g.hint}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            {GROUPS.find((g) => g.id === engine)?.hint}
          </p>

          {/* Piper voices */}
          {engine === "piper" && (
            <div className="mt-3 space-y-1.5">
              {(piperVoices ?? []).map((v) => {
                const st = piperStates[`${v.key}#${v.speaker ?? 0}`] ?? { status: "idle" };
                const firstVoice = piperVoices?.[0];
                const selected =
                  piperChoice === `${v.key}#${v.speaker ?? 0}` ||
                  (piperChoice === "auto" && firstVoice === v);
                return (
                  <VoiceRow
                    key={`${v.key}#${v.speaker ?? 0}`}
                    label={v.label}
                    badge={`${v.sizeMB} MB`}
                    status={dlText(st as DownloadState)}
                    selected={selected}
                    busy={previewing === v.key}
                    onSelect={() => choosePiperVoice(v)}
                    onPreview={() =>
                      preview(v.key, {
                        engine: "piper",
                        piperKey: v.key,
                        speaker: v.speaker,
                        lang: langCode,
                      })
                    }
                  />
                );
              })}
              {piperVoices && piperVoices.length === 0 && (
                <p className="text-xs text-ink-400">
                  Piper ainda não tem voz para este idioma — use Auto, Kokoro ou Gemini.
                </p>
              )}
              {!piperVoices && (
                <p className="text-xs text-ink-400">carregando vozes…</p>
              )}
            </div>
          )}

          {/* Kokoro voices */}
          {engine === "kokoro" && (
            <div className="mt-3 space-y-1.5">
              {kokoroVoices.map((v) => {
                const selected = kokoroGender === v.gender;
                return (
                  <VoiceRow
                    key={v.id}
                    label={v.label}
                    badge={kokoroDl.status === "ready" ? "✓" : "92 MB"}
                    status={kokoroDl.status === "downloading" ? `baixando ${kokoroDl.pct}%` : dlText(kokoroDl)}
                    selected={selected}
                    busy={previewing === v.id}
                    onSelect={() => chooseKokoroVoice(v.gender)}
                    onPreview={() =>
                      preview(v.id, { engine: "kokoro", gender: v.gender, lang: langCode })
                    }
                  />
                );
              })}
              {kokoroVoices.length === 0 && (
                <p className="text-xs text-ink-400">
                  Kokoro ainda não tem voz para este idioma — use Auto, Piper ou Gemini.
                </p>
              )}
            </div>
          )}

          {/* Gemini & Browser: informational */}
          {engine === "gemini" && (
            <p className="mt-3 text-xs text-ink-400">
              A voz Gemini é gerada na nuvem — não há vozes para escolher.
            </p>
          )}
          {engine === "browser" && !speechSupported() && (
            <p className="mt-3 text-xs text-terracotta-600">
              Seu navegador não suporta síntese de voz.
            </p>
          )}
          {engine === "browser" && speechSupported() && (
            <p className="mt-3 text-xs text-ink-400">
              Usa as vozes instaladas no seu dispositivo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function VoiceRow(props: {
  label: string;
  badge?: string;
  status?: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
        props.selected
          ? "border-terracotta-400 bg-terracotta-50"
          : "border-paper-200 bg-card hover:border-terracotta-400"
      }`}
    >
      <button
        type="button"
        onClick={props.onSelect}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <span
          className={`inline-block h-3 w-3 shrink-0 rounded-full border-2 ${
            props.selected ? "border-terracotta-500 bg-terracotta-500" : "border-paper-300"
          }`}
        />
        <span className="text-sm text-ink-700">{props.label}</span>
        {props.badge && (
          <span className="text-[11px] text-ink-400">{props.badge}</span>
        )}
        {props.status && (
          <span className="text-[11px] font-medium text-sage-600">{props.status}</span>
        )}
      </button>
      <button
        type="button"
        onClick={props.onPreview}
        disabled={props.busy}
        className="rounded-full px-2 py-1 text-xs font-semibold text-terracotta-600 hover:bg-terracotta-50 disabled:opacity-40"
        title="Ouvir amostra"
      >
        {props.busy ? "…" : "▶"}
      </button>
    </div>
  );
}
