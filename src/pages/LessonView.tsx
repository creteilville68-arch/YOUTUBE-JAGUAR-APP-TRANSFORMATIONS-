import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "../components/AppShell";
import { YouTubeSync } from "../components/YouTubeSync";
import { Exercises } from "../components/Exercises";
import { findLanguage } from "../lib/languages";
import { speak, stopSpeaking, warmVoices, speechSupported } from "../lib/speech";
import { WordLookup } from "../components/WordLookup";
import { Id } from "../../convex/_generated/dataModel";

type Sent = { target: string; native: string };
type VocabItem = {
  term: string;
  wordClass: string;
  meanings: string[];
  contextNote: string;
  examples: Sent[];
};
type Block = {
  sensTarget?: string;
  sensNative?: string;
  groups: { sentences: Sent[]; vocab: VocabItem[] }[];
};

const TABS = [
  { key: "study", label: "📝 Estudo" },
  { key: "video", label: "🎬 Vídeo" },
  { key: "reading", label: "🎧 Leitura" },
  { key: "exercises", label: "✏️ Exercícios" },
  { key: "print", label: "📄 PDF" },
  { key: "text", label: "🔤 Texto" },
] as const;

function normalizeBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as { sensTarget?: unknown; sensNative?: unknown; groups?: unknown };
    if (!Array.isArray(raw.groups)) return [];
    const groups = raw.groups.flatMap((group) => {
      if (!group || typeof group !== "object") return [];
      const rawGroup = group as { sentences?: unknown; vocab?: unknown };
      const sentences = Array.isArray(rawGroup.sentences)
        ? rawGroup.sentences.flatMap((sentence) => {
            if (!sentence || typeof sentence !== "object") return [];
            const s = sentence as { target?: unknown; native?: unknown };
            return typeof s.target === "string" && typeof s.native === "string"
              ? [{ target: s.target, native: s.native }]
              : [];
          })
        : [];
      const vocab = Array.isArray(rawGroup.vocab)
        ? rawGroup.vocab.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const v = entry as {
              term?: unknown;
              wordClass?: unknown;
              meanings?: unknown;
              contextNote?: unknown;
              examples?: unknown;
            };
            if (typeof v.term !== "string") return [];
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
              meanings: Array.isArray(v.meanings)
                ? v.meanings.filter((m): m is string => typeof m === "string")
                : [],
              contextNote: typeof v.contextNote === "string" ? v.contextNote : "",
              examples,
            }];
          })
        : [];
      return sentences.length > 0 ? [{ sentences, vocab }] : [];
    });
    return groups.length > 0
      ? [{
          sensTarget: typeof raw.sensTarget === "string" ? raw.sensTarget : "",
          sensNative: typeof raw.sensNative === "string" ? raw.sensNative : "",
          groups,
        }]
      : [];
  });
}

export function LessonView() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const lesson = useQuery(
    api.lessons.get,
    id ? { id: id as Id<"lessons"> } : "skip",
  );

  const start = useMutation(api.lessons.start);
  const addVocab = useMutation(api.vocab.addVocab);
  const touchStreak = useMutation(api.streak.touch);
  const series = useQuery(
    api.lessons.getGroup,
    lesson?.groupId ? { groupId: lesson.groupId } : "skip",
  );
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("study");
  const [error, setError] = useState("");
  const [triggered, setTriggered] = useState(false);
  const recoveryAttemptedAt = useRef(0);

  useEffect(() => {
    warmVoices();
    return () => stopSpeaking();
  }, []);

  const blocks = useMemo(() => normalizeBlocks(lesson?.blocks), [lesson?.blocks]);
  const allSentences: Sent[] = useMemo(
    () => blocks.flatMap((b) => b.groups.flatMap((g) => g.sentences)),
    [blocks],
  );
  const vocabAll: VocabItem[] = useMemo(() => {
    const seen = new Set<string>();
    const out: VocabItem[] = [];
    for (const b of blocks) {
      for (const g of b.groups) {
        for (const v of g.vocab) {
          const key = v.term.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push(v);
          }
        }
      }
    }
    return out;
  }, [blocks]);

  useEffect(() => {
    if (!lesson || !id || lesson.status === "ready") return;

    // Processing is owned by the server queue. A page reload must simply keep
    // showing its progress instead of starting another browser action.
    if (lesson.status === "processing") {
      if (!triggered) setTriggered(true);
      return;
    }

    // Drafts and failures are started by the explicit process link or button.
    if (lesson.status !== "draft" && lesson.status !== "failed") return;
    if (!params.get("process") && !triggered) return;

    setTriggered(true);
    void (async () => {
      try {
        await start({ id: id as Id<"lessons"> });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao iniciar a geração.");
        setTriggered(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?._id, lesson?.status, triggered, id, params]);

  // Recover a worker that dies while this page remains open. Convex normally
  // handles this through the cron, but this client-side safety net also covers
  // an older lesson created before worker leases existed.
  useEffect(() => {
    const recoverIfStale = () => {
      if (!lesson || !id || lesson.status !== "processing") return;
      if (Date.now() - lesson.updatedAt <= 5 * 60_000) return;
      if (Date.now() - recoveryAttemptedAt.current < 60_000) return;
      recoveryAttemptedAt.current = Date.now();
      void start({ id: id as Id<"lessons"> }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Erro ao retomar a geração.");
      });
    };

    recoverIfStale();
    const timer = window.setInterval(recoverIfStale, 60_000);
    return () => window.clearInterval(timer);
  }, [lesson?._id, lesson?.status, lesson?.updatedAt, id, start]);

  // Record study activity for the daily streak when a lesson is opened.
  // (Hooks must stay ABOVE the loading early-return below — the hook count
  // must be identical on every render or React unmounts the whole tree.)
  useEffect(() => {
    if (lesson?.status === "ready") {
      void touchStreak({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?._id, lesson?.status]);

  // NOTE: series chaining (starting the next part when this one finishes) is
  // owned by the server queue (pipelineQueue.runQueue) — doing it here too
  // raced with the scheduler and could double-start a part.

  if (!lesson) {
    return (
      <AppShell>
        <div className="card-panel flex items-center gap-3 p-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-300 border-t-terracotta-500" />
          <span className="text-sm text-ink-500">Carregando aula…</span>
        </div>
      </AppShell>
    );
  }

  const lang = findLanguage(lesson.targetLang);
  const langCode = lang?.code ?? "en-US";
  const isProcessing = lesson.status === "processing" && triggered && !error;
  const fullText = allSentences.map((s) => s.target).join(" ");
  const timeMap = (lesson.timeMap ?? []) as { start: number; text: string }[];

  return (
    <AppShell>
      {/* Pipeline error */}
      {error && (
        <div className="card-panel mb-6 border-l-4 border-l-terracotta-500 p-5">
          <p className="font-semibold text-terracotta-600">Falha ao gerar a aula</p>
          <p className="mt-1 text-sm text-ink-500">{error}</p>
          <button
            className="btn-secondary mt-3"
            onClick={() => {
              setError("");
              setTriggered(true);
            }}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* Header */}
      <div className="no-print mb-6">
        <Link
          to="/app"
          className="text-sm font-medium text-ink-400 hover:text-terracotta-600"
        >
          ← Minhas aulas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-bold text-ink-900">{lesson.title}</h1>
          <span className="pill bg-paper-100 text-ink-500">
            {lang?.flag} {lang?.label ?? lesson.targetLang}
          </span>
        </div>

        {/* Series navigator — one long video split into parts */}
        {series && series.length > 1 && (
          <div className="card-panel no-print mt-4 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Série · {series.length} partes ·{" "}
              {series.filter((s) => s.status === "ready").length} prontas
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {series.map((p) => {
                const cls =
                  p._id === lesson._id
                    ? "bg-terracotta-500 text-white"
                    : p.status === "ready"
                      ? "bg-sage-100 text-sage-600 hover:bg-sage-400 hover:text-white"
                      : p.status === "failed"
                        ? "bg-terracotta-50 text-terracotta-600"
                        : p.status === "processing"
                          ? "bg-paper-100 text-ink-500 animate-pulse"
                          : "bg-paper-100 text-ink-400";
                const label =
                  p.status === "ready"
                    ? `✓ ${p.partIndex}`
                    : p.status === "processing"
                      ? `⏳ ${p.partIndex}`
                      : p.status === "failed"
                        ? `✕ ${p.partIndex}`
                        : `${p.partIndex}`;
                return p._id === lesson._id ? (
                  <span key={p._id} className={`pill px-3.5 py-1.5 text-sm font-bold ${cls}`}>
                    {p.partIndex}/{series.length}
                  </span>
                ) : (
                  <Link
                    key={p._id}
                    to={`/app/aula/${p._id}${p.status === "ready" ? "" : "?process=1"}`}
                    title={p.title}
                    className={`pill px-3.5 py-1.5 text-sm font-semibold transition ${cls}`}
                  >
                    {label}
                  </Link>
                );
              })}
              {(() => {
                const next = series.find((s) => s.status === "ready" && s.partIndex === (lesson.partIndex ?? 1) + 1);
                if (!next) return null;
                return (
                  <Link
                    to={`/app/aula/${next._id}`}
                    className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-terracotta-600 hover:underline"
                  >
                    Continuar para a Parte {next.partIndex} →
                  </Link>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Interrupted or failed pipeline (opened fresh, nothing running locally) */}
      {(lesson.status === "processing" || lesson.status === "failed") &&
        !triggered &&
        !error && (
          <div className="card-panel mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-serif text-lg font-semibold text-ink-900">
                {lesson.status === "failed"
                  ? "A geração desta aula falhou."
                  : "A geração desta aula foi interrompida."}
              </p>
              <p className="text-sm text-ink-500">
                {lesson.progress && lesson.status === "failed"
                  ? `Motivo: ${lesson.progress}`
                  : "Retome para concluir a aula — o que já foi gerado é reaproveitado."}
              </p>
            </div>
            <button className="btn-primary" onClick={() => setTriggered(true)}>
              Retomar geração
            </button>
          </div>
        )}

      {/* Draft opened directly: explain what will happen and start it */}
      {lesson.status === "draft" && !triggered && !error && (
        <div className="card-panel mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-serif text-lg font-semibold text-ink-900">
              Aula ainda não gerada
            </p>
            <p className="text-sm text-ink-500">
              Toque em gerar para a IA montar as frases, tradução e vocabulário (1–3 min).
            </p>
          </div>
          <button className="btn-primary" onClick={() => setTriggered(true)}>
            ⚡ Gerar aula agora
          </button>
        </div>
      )}

      {/* Processing state */}
      {isProcessing && (
        <div className="card-panel flex flex-col items-center px-6 py-14 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-paper-300 border-t-terracotta-500" />
          <h2 className="mt-5 font-serif text-xl font-semibold text-ink-900">
            Montando sua aula…
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
            A IA está restaurando a pontuação, dividindo em frases, traduzindo e escolhendo
            o vocabulário. Pode levar de 1 a 3 minutos.
          </p>
          {lesson.progress && (
            <p className="mt-4 rounded-full bg-paper-100 px-4 py-1.5 text-xs font-semibold text-terracotta-600">
              {lesson.progress}
            </p>
          )}
        </div>
      )}

      {/* Lesson ready */}
      {lesson.status === "ready" && !error && (
        <>
          {lesson.summary && (
            <div className="card-panel mb-6 border-l-4 border-l-sage-400 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-sage-600">
                Resumo do vídeo
              </p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                {lesson.summary}
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="no-print mb-6 flex gap-1 overflow-x-auto rounded-xl bg-paper-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  stopSpeaking();
                  setTab(t.key);
                }}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  tab === t.key ? "bg-card text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Study tab */}
          {tab === "study" && (
            <div className="space-y-6">
              {blocks.map((block, bi) => (
                <div key={bi} className="card-panel p-5 sm:p-6">
                  {(block.sensTarget || block.sensNative) && (
                    <p className="mb-4 border-b border-paper-200 pb-3 text-sm italic leading-relaxed text-ink-500">
                      {block.sensTarget}
                      {block.sensNative && <span className="text-ink-400"> — {block.sensNative}</span>}
                    </p>
                  )}
                  <div className="space-y-4">
                    {block.groups.map((group, gi) => (
                      <div key={gi} className="print-break">
                        {group.sentences.map((s, si) => (
                          <div key={si} className="mb-3 last:mb-0">
                            <p className="font-serif text-lg leading-relaxed text-ink-900">
                              {s.target.split(/(\s+)/).map((piece, pi) =>
                                /^\p{L}+$/u.test(piece) ? (
                                  <WordLookup
                                    key={pi}
                                    word={piece}
                                    sentence={s.target}
                                    lessonId={lesson._id}
                                    targetLang={lesson.targetLang}
                                    nativeLang={lesson.nativeLang}
                                  />
                                ) : (
                                  <span key={pi}>{piece}</span>
                                ),
                              )}
                            </p>
                            <p className="mt-0.5 text-sm text-ink-500">{s.native}</p>
                          </div>
                        ))}
                        {group.vocab.length > 0 && (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {group.vocab.map((v, vi) => (
                              <div key={vi} className="rounded-xl border border-paper-200 bg-paper-50 p-3.5">
                                <p className="font-serif font-semibold text-ink-900">
                                  {v.term}{" "}
                                  <span className="text-xs font-normal text-ink-400">
                                    · {v.wordClass}
                                  </span>
                                </p>
                                <ul className="mt-1 list-inside list-disc text-sm text-ink-500">
                                  {v.meanings.map((m, mi) => (
                                    <li key={mi}>{m}</li>
                                  ))}
                                </ul>
                                {v.contextNote && (
                                  <p className="mt-1 text-xs italic text-ink-400">{v.contextNote}</p>
                                )}
                                {v.examples[0] && (
                                  <p className="mt-1.5 text-sm text-ink-700">
                                    {v.examples[0].target}
                                    <span className="block text-xs text-ink-400">
                                      {v.examples[0].native}
                                    </span>
                                  </p>
                                )}
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={() => speak(v.term, langCode)}
                                    className="pill bg-paper-100 text-ink-500 hover:text-terracotta-600"
                                  >
                                    🔊 Ouvir
                                  </button>
                                  <button
                                    onClick={() =>
                                      void addVocab({ entry: v, lessonId: lesson._id, sourceSentence: group.sentences[0]?.target })
                                    }
                                    className="pill bg-sage-100 text-sage-600 hover:bg-sage-400 hover:text-white"
                                  >
                                    ＋ Salvar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Video tab */}
          {tab === "video" && (
            <>
              {lesson.videoId && timeMap.length === allSentences.length && allSentences.length > 0 ? (
                <YouTubeSync
                  videoId={lesson.videoId}
                  sentences={allSentences}
                  timeMap={timeMap}
                  langCode={langCode}
                />
              ) : (
                <div className="card-panel p-8 text-center">
                  <span className="text-3xl">🎬</span>
                  <p className="mt-3 font-serif text-lg font-semibold text-ink-900">
                    Modo vídeo indisponível para esta aula
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
                    {lesson.videoId
                      ? "Não conseguimos alinhar as frases com a legendagem do vídeo."
                      : "Importe a próxima aula pela URL do YouTube para estudar com o vídeo sincronizado."}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Exercises tab */}
          {tab === "exercises" && <Exercises sentences={allSentences} langCode={langCode} />}

          {/* Reading tab */}
          {tab === "reading" && (
            <div className="card-panel p-5 sm:p-6">
              <div className="no-print mb-4 flex items-center gap-3">
                <button
                  className="btn-primary"
                  onClick={() => speak(fullText, langCode, 0.85)}
                >
                  ▶ Ouvir tudo
                </button>
                <button className="btn-secondary" onClick={stopSpeaking}>
                  ⏸ Parar
                </button>
                {!speechSupported() && (
                  <span className="text-xs text-terracotta-600">
                    Seu navegador não suporta síntese de voz.
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {allSentences.map((s, i) => (
                  <p
                    key={i}
                    className="cursor-pointer rounded-lg px-2 py-1 transition hover:bg-paper-100"
                    onClick={() => speak(s.target, langCode)}
                  >
                    <span className="mr-2 font-mono text-xs text-ink-400">{i + 1}</span>
                    <span className="font-serif text-lg text-ink-900">{s.target}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Print tab */}
          {tab === "print" && (
            <div>
              <div className="no-print card-panel mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-serif text-lg font-semibold text-ink-900">
                    Exportar aula em PDF
                  </p>
                  <p className="text-sm text-ink-500">
                    Abre a janela de impressão do navegador — escolha “Salvar como PDF”.
                  </p>
                </div>
                <button className="btn-primary" onClick={() => window.print()}>
                  🖨 Imprimir / Salvar PDF
                </button>
              </div>
              <p className="no-print text-sm text-ink-400">
                O documento inclui todas as {allSentences.length} frases com tradução e a lista
                completa de vocabulário.
              </p>
            </div>
          )}

          {/* Hidden print document (visible only when printing) */}
          <div id="print-root" aria-hidden>
            <h1 style={{ fontSize: 24, fontWeight: 700, fontFamily: "Georgia, serif" }}>
              {lesson.title}
            </h1>
            <p style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
              {lang?.label ?? lesson.targetLang} → {lesson.nativeLang} · LínguaViva
            </p>
            {lesson.summary && (
              <p style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{lesson.summary}</p>
            )}
            <div style={{ marginTop: 16 }}>
              {allSentences.map((s, i) => (
                <div key={i} style={{ marginBottom: 10, breakInside: "avoid" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>
                    {i + 1}. {s.target}
                  </p>
                  <p style={{ fontSize: 13, color: "#444", lineHeight: 1.4 }}>{s.native}</p>
                </div>
              ))}
            </div>
            {vocabAll.length > 0 && (
              <div style={{ marginTop: 16, breakInside: "avoid" }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, fontFamily: "Georgia, serif" }}>
                  Vocabulário
                </h2>
                {vocabAll.map((v, i) => (
                  <p key={i} style={{ fontSize: 12, marginBottom: 4, lineHeight: 1.45 }}>
                    <strong>{v.term}</strong> ({v.wordClass}) — {v.meanings.join(" · ")}
                    {v.contextNote ? ` — ${v.contextNote}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Full text tab */}
          {tab === "text" && (
            <div className="card-panel p-5 sm:p-6">
              <div className="no-print mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink-700">
                  Tudo em texto simples, pronto para copiar.
                </p>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    const text = allSentences
                      .map((s, i) => `${s.target}\n${s.native}\n`)
                      .join("\n");
                    void navigator.clipboard.writeText(text);
                  }}
                >
                  📋 Copiar tudo
                </button>
              </div>
              <div className="max-h-[480px] space-y-2 overflow-y-auto rounded-xl bg-paper-50 p-4 font-mono text-[13px] leading-relaxed">
                {allSentences.map((s, i) => (
                  <p key={i}>
                    <span className="text-ink-900">{s.target}</span>
                    <br />
                    <span className="text-ink-500">{s.native}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
