import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "../components/AppShell";
import { CEFR_LEVELS } from "../lib/languages";
import { speak, stopSpeaking } from "../lib/speech";
import { Id } from "../../convex/_generated/dataModel";

type GradeKey = "again" | "hard" | "good" | "easy";

const GRADES: { key: GradeKey; label: string; cls: string }[] = [
  { key: "again", label: "De novo", cls: "border-terracotta-400 bg-terracotta-50 text-terracotta-600" },
  { key: "hard", label: "Difícil", cls: "border-paper-300 bg-paper-100 text-ink-700" },
  { key: "good", label: "Bom", cls: "border-sage-400 bg-sage-100 text-sage-600" },
  { key: "easy", label: "Fácil", cls: "border-paper-300 bg-paper-50 text-ink-700" },
];

export function Vocabulary() {
  const vocab = useQuery(api.vocab.listVocab);
  const due = useQuery(api.srs.dueCards);
  const gradeCard = useMutation(api.srs.grade);
  const generateExamples = useAction(api.ai.generateExamples);
  const saveExamples = useMutation(api.vocab.saveExamples);
  const removeVocab = useMutation(api.vocab.removeVocab);

  const [mode, setMode] = useState<"list" | "review" | "quiz">("list");
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizScore, setQuizScore] = useState({ ok: 0, total: 0 });
  const [quizAnswered, setQuizAnswered] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [cefr, setCefr] = useState("B1");
  const [exampleCount, setExampleCount] = useState(3);
  const [busyId, setBusyId] = useState<Id<"vocab"> | null>(null);
  const [genError, setGenError] = useState("");

  const dueList = useMemo(() => due ?? [], [due]);
  const totalReviews = dueList.length;
  const card = dueList[reviewIndex];

  const quizPool = useMemo(
    () => (vocab ?? []).filter((v) => v.meanings.length > 0),
    [vocab],
  );
  const quizItem = quizPool.length >= 4 ? quizPool[quizIdx % quizPool.length] : null;
  const quizOptions = useMemo(() => {
    if (!quizItem) return [];
    const others = quizPool.filter((v) => v._id !== quizItem._id);
    const shuffled = [...others].sort(() => Math.random() - 0.5).slice(0, 3);
    return [quizItem, ...shuffled]
      .map((v) => v.meanings[0])
      .sort(() => Math.random() - 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizItem?._id]);

  function answerQuiz(meaning: string) {
    if (!quizItem || quizAnswered) return;
    setQuizAnswered(meaning);
    const ok = meaning === quizItem.meanings[0];
    setQuizScore((s) => ({ ok: s.ok + (ok ? 1 : 0), total: s.total + 1 }));
  }

  function nextQuiz() {
    setQuizAnswered(null);
    setQuizIdx((i) => i + 1);
  }

  function exportCsv() {
    if (!vocab || vocab.length === 0) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ["#separator:Comma", "#html:false", "#columns:termo,classe,significados,nota de contexto,exemplo,tradução do exemplo"];
    for (const item of vocab) {
      const ex = item.examples[0];
      lines.push(
        [
          esc(item.term),
          esc(item.wordClass),
          esc(item.meanings.join(" | ")),
          esc(item.contextNote),
          esc(ex?.target ?? ""),
          esc(ex?.native ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "linguaviva-vocabulario.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleGrade(g: GradeKey) {
    if (!card) return;
    void gradeCard({ cardId: card.cardId, grade: g });
    setShowBack(false);
    setReviewIndex((i) => i + 1);
  }

  if (mode === "quiz" && quizItem && quizOptions.length === 4) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() => {
                setMode("list");
                setQuizAnswered(null);
              }}
              className="text-sm font-medium text-ink-400 hover:text-terracotta-600"
            >
              ← Sair do quiz
            </button>
            <p className="text-sm font-semibold text-ink-500">
              Acertos: {quizScore.ok}/{quizScore.total}
            </p>
          </div>
          <div className="card-panel p-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Qual é o significado de…
            </p>
            <h2 className="mt-2 font-serif text-4xl font-bold text-ink-900">
              {quizItem.term}
            </h2>
            <div className="mt-6 grid gap-2">
              {quizOptions.map((opt, i) => {
                const isRight = opt === quizItem.meanings[0];
                const chosen = quizAnswered === opt;
                const cls = !quizAnswered
                  ? "border-paper-300 bg-card text-ink-700 hover:border-terracotta-400"
                  : isRight
                    ? "border-sage-400 bg-sage-100 text-sage-600"
                    : chosen
                      ? "border-terracotta-400 bg-terracotta-50 text-terracotta-600"
                      : "border-paper-200 bg-paper-50 text-ink-400";
                return (
                  <button
                    key={i}
                    disabled={Boolean(quizAnswered)}
                    onClick={() => answerQuiz(opt)}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${cls}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {quizAnswered && (
              <button className="btn-primary mt-5" onClick={nextQuiz}>
                Próxima →
              </button>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  if (mode === "review" && card) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() => {
                stopSpeaking();
                setMode("list");
              }}
              className="text-sm font-medium text-ink-400 hover:text-terracotta-600"
            >
              ← Sair da revisão
            </button>
            <p className="text-sm font-semibold text-ink-500">
              {Math.min(reviewIndex + 1, totalReviews)} / {totalReviews}
            </p>
          </div>
          <div className="card-panel p-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              {card.wordClass}
            </p>
            <h2 className="mt-2 font-serif text-4xl font-bold text-ink-900">{card.term}</h2>
            {!showBack ? (
              <button className="btn-secondary mt-8 w-full py-3" onClick={() => setShowBack(true)}>
                Mostrar resposta
              </button>
            ) : (
              <div className="mt-6 text-left">
                <ul className="list-inside list-disc text-sm text-ink-700">
                  {card.meanings.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                {card.contextNote && (
                  <p className="mt-2 text-xs italic text-ink-400">{card.contextNote}</p>
                )}
                <div className="mt-4 space-y-2">
                  {card.examples.map((ex, i) => (
                    <p key={i} className="text-sm">
                      <span className="text-ink-900">{ex.target}</span>
                      <span className="block text-xs text-ink-400">{ex.native}</span>
                    </p>
                  ))}
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {GRADES.map((g) => (
                    <button
                      key={g.key}
                      onClick={() => handleGrade(g.key)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition hover:shadow-sm ${g.cls}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => speak(card.term, "en-US")}
              className="mt-4 text-sm text-ink-400 hover:text-terracotta-600"
            >
              🔊 Ouvir
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-ink-400">
            Repetição espaçada (SM-2): "De novo" zera o cartão; as demais notas aumentam o intervalo.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-ink-900">Vocabulário</h1>
          <p className="mt-1 text-ink-500">
            {vocab === undefined
              ? "Carregando…"
              : `${vocab.length} ${vocab.length === 1 ? "palavra" : "palavras"} salvas · ${totalReviews} vencida${totalReviews === 1 ? "" : "s"} hoje`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {totalReviews > 0 && (
            <button
              className="btn-primary"
              onClick={() => {
                setReviewIndex(0);
                setShowBack(false);
                setMode("review");
              }}
            >
              🔁 Revisar {totalReviews} agora
            </button>
          )}
          {quizPool.length >= 4 && (
            <button
              className="btn-secondary"
              onClick={() => {
                setQuizIdx(0);
                setQuizScore({ ok: 0, total: 0 });
                setQuizAnswered(null);
                setMode("quiz");
              }}
            >
              ❓ Quiz rápido
            </button>
          )}
          {vocab && vocab.length > 0 && (
            <button className="btn-secondary" onClick={exportCsv}>
              ⬇ Exportar CSV (Anki)
            </button>
          )}
        </div>
      </div>

      <div className="card-panel mb-6 flex flex-wrap items-end gap-4 p-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            Nível CEFR para novos exemplos
          </label>
          <select className="field w-40" value={cefr} onChange={(e) => setCefr(e.target.value)}>
            {CEFR_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            Exemplos por palavra
          </label>
          <select
            className="field w-40"
            value={exampleCount}
            onChange={(e) => setExampleCount(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <p className="ml-auto max-w-xs text-xs text-ink-400">
          Gere exemplos sob medida no nível escolhido para cada palavra salva (1 chamada de IA por palavra).
        </p>
      </div>

      {vocab === undefined ? (
        <div className="card-panel h-40 animate-pulse bg-paper-100/60" />
      ) : vocab.length === 0 ? (
        <div className="card-panel flex flex-col items-center px-6 py-16 text-center">
          <span className="text-4xl">🗂️</span>
          <h3 className="mt-4 font-serif text-xl font-semibold text-ink-900">
            Nenhuma palavra salva ainda
          </h3>
          <p className="mt-2 max-w-sm text-sm text-ink-500">
            Durante a aula, toque em qualquer palavra para consultá-la no dicionário e salvá-la aqui.
          </p>
          <Link to="/app" className="btn-primary mt-6">
            Ir para as aulas
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {vocab.map((item) => (
            <div key={item._id} className="card-panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-lg font-semibold text-ink-900">
                    {item.term}{" "}
                    <span className="text-xs font-normal text-ink-400">· {item.wordClass}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {item.card
                      ? `Revisão: ${new Date(item.card.dueAt).toLocaleDateString("pt-BR")} · intervalo ${item.card.intervalDays}d`
                      : "Sem cartão"}
                  </p>
                </div>
                <button
                  onClick={() => void removeVocab({ id: item._id })}
                  className="rounded-lg px-2 py-1 text-xs text-ink-400 hover:text-terracotta-600"
                >
                  Remover
                </button>
              </div>
              <ul className="mt-3 list-inside list-disc text-sm text-ink-500">
                {item.meanings.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              <div className="mt-3 space-y-1.5">
                {item.examples.map((ex, i) => (
                  <p key={i} className="text-sm">
                    <span className="text-ink-900">{ex.target}</span>
                    <span className="block text-xs text-ink-400">{ex.native}</span>
                  </p>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  className="pill bg-paper-100 text-ink-500 hover:text-terracotta-600"
                  onClick={() => speak(item.term, "en-US")}
                >
                  🔊 Ouvir
                </button>
                <button
                  className="pill bg-sage-100 text-sage-600 hover:bg-sage-400 hover:text-white"
                  disabled={busyId === item._id}                    onClick={async () => {
                      setBusyId(item._id);
                      setGenError("");
                      try {
                        const { examples } = await generateExamples({
                          term: item.term,
                          wordClass: item.wordClass,
                          meanings: item.meanings,
                          count: exampleCount,
                          cefr,
                          targetLang: item.targetLang ?? "English",
                          nativeLang: item.nativeLang ?? "Portuguese (Brazil)",
                        });
                        await saveExamples({ vocabId: item._id, examples });
                      } catch (err) {
                        setGenError(err instanceof Error ? err.message : "Erro ao gerar exemplos.");
                      } finally {
                        setBusyId(null);
                      }
                    }}
                >
                  {busyId === item._id ? "Gerando…" : `✨ Gerar exemplos (nível ${cefr})`}
                </button>
              </div>
              {genError && (
                <p className="mt-2 text-xs text-terracotta-600">{genError}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
