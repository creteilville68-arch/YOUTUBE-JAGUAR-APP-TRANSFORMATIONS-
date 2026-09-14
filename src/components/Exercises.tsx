import { useMemo, useState } from "react";
import { speak, speechSupported } from "../lib/speech";

type Sent = { target: string; native: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function pickBlank(sentence: string): { before: string; word: string; after: string } | null {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < 5) return null;
  const candidates = words
    .map((w, i) => ({ w: w.replace(/[^\p{L}\p{N}'-]/gu, ""), i }))
    .filter((x) => x.w.length >= 4 && x.i > 0 && x.i < words.length - 1);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(candidates.length / 2)];
  const clean = (i: number) => words.slice(0, i).join(" ");
  return {
    before: clean(pick.i),
    word: pick.w,
    after: words.slice(pick.i + 1).join(" "),
  };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: 1;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export function Exercises({
  sentences,
  langCode,
}: {
  sentences: Sent[];
  langCode: string;
}) {
  const [mode, setMode] = useState<"cloze" | "shadow">("cloze");

  // Cloze state
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [score, setScore] = useState({ ok: 0, total: 0 });

  // Shadowing state
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [shadowIdx, setShadowIdx] = useState(0);
  const [recSupported, setRecSupported] = useState(true);

  const sent = sentences[idx % Math.max(1, sentences.length)];
  const blank = useMemo(() => (sent ? pickBlank(sent.target) : null), [sent?.target]);
  const shadowSent = sentences[shadowIdx % Math.max(1, sentences.length)];

  function checkCloze() {
    if (!blank) return;
    const ok = norm(answer) === norm(blank.word);
    setChecked(ok);
    setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), total: s.total + 1 }));
  }

  function nextCloze() {
    setIdx((i) => i + 1);
    setAnswer("");
    setChecked(null);
  }

  const SpeechRec =
    typeof window !== "undefined"
      ? ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition)
      : undefined;

  function startShadow() {
    if (!SpeechRec) {
      setRecSupported(false);
      return;
    }
    setHeard("");
    const rec = new SpeechRec();
    rec.lang = langCode;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => setHeard(e.results[0][0].transcript);
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  if (sentences.length === 0) {
    return <p className="text-sm text-ink-400">Sem frases para exercitar.</p>;
  }

  return (
    <div>
      <div className="no-print mb-5 flex gap-1 rounded-xl bg-paper-100 p-1">
        <button
          onClick={() => setMode("cloze")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            mode === "cloze" ? "bg-card text-ink-900 shadow-sm" : "text-ink-500"
          }`}
        >
          ✏️ Completar a frase
        </button>
        <button
          onClick={() => setMode("shadow")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            mode === "shadow" ? "bg-card text-ink-900 shadow-sm" : "text-ink-500"
          }`}
        >
          🎤 Shadowing
        </button>
      </div>

      {mode === "cloze" && (
        <div className="card-panel mx-auto max-w-2xl p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Frase {idx + 1} · acertos {score.ok}/{score.total}
          </p>
          {blank ? (
            <>
              <p className="mt-4 font-serif text-xl leading-relaxed text-ink-900">
                {blank.before}{" "}
                <span className="mx-1 inline-block min-w-[110px] border-b-2 border-terracotta-400 text-center text-terracotta-600">
                  {checked !== null ? blank.word : "…"}
                </span>{" "}
                {blank.after}
              </p>
              <p className="mt-2 text-sm text-ink-400">{sent.native}</p>
              {checked === null ? (
                <div className="mt-6 flex justify-center gap-2">
                  <input
                    className="field max-w-xs text-center"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Palavra que falta"
                    onKeyDown={(e) => e.key === "Enter" && checkCloze()}
                  />
                  <button className="btn-primary" onClick={checkCloze} disabled={!answer.trim()}>
                    Verificar
                  </button>
                </div>
              ) : (
                <div className="mt-6">
                  <p className={`text-sm font-semibold ${checked ? "text-sage-600" : "text-terracotta-600"}`}>
                    {checked ? "✓ Correto!" : `✕ Era "${blank.word}"`}
                  </p>
                  <button className="btn-primary mt-3" onClick={nextCloze}>
                    Próxima frase →
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-ink-500">
              Esta frase é curta demais para o exercício.{" "}
              <button className="font-semibold text-terracotta-600 hover:underline" onClick={nextCloze}>
                Pular
              </button>
            </p>
          )}
        </div>
      )}

      {mode === "shadow" && (
        <div className="card-panel mx-auto max-w-2xl p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Ouça, repita em voz alta, compare
          </p>
          <p className="mt-4 font-serif text-xl leading-relaxed text-ink-900">
            {shadowSent.target}
          </p>
          <p className="mt-2 text-sm text-ink-400">{shadowSent.native}</p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => speak(shadowSent.target, langCode, 0.85)}
            >
              🔊 Ouvir
            </button>
            <button className="btn-primary" onClick={startShadow} disabled={listening}>
              {listening ? "🎙 Ouvindo…" : "🎤 Falar agora"}
            </button>
          </div>
          {!recSupported && (
            <p className="mt-3 text-xs text-terracotta-600">
              Reconhecimento de fala não disponível neste navegador — pratique ouvindo e repetindo.
            </p>
          )}
          {heard && (
            <div className="mt-5 rounded-xl bg-paper-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Você disse
              </p>
              <p className="mt-1 font-serif text-lg text-ink-900">“{heard}”</p>
              {norm(heard) === norm(shadowSent.target) ? (
                <p className="mt-1 text-sm font-semibold text-sage-600">✓ Perfeito!</p>
              ) : (
                <p className="mt-1 text-sm text-ink-500">
                  Compare com o original e tente de novo — preste atenção às terminações.
                </p>
              )}
            </div>
          )}
          <button
            className="mt-6 text-sm font-medium text-ink-400 hover:text-terracotta-600"
            onClick={() => setShadowIdx((i) => i + 1)}
          >
            Próxima frase →
          </button>
        </div>
      )}
    </div>
  );
}
