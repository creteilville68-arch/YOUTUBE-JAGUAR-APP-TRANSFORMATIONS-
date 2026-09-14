import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "../components/AppShell";
import { Doc } from "../../convex/_generated/dataModel";
import { findLanguage } from "../lib/languages";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Na fila para gerar…", cls: "bg-paper-100 text-ink-500 animate-pulse" },
  processing: { label: "Gerando…", cls: "bg-paper-100 text-ink-500 animate-pulse" },
  ready: { label: "Pronta", cls: "bg-sage-100 text-sage-600" },
  failed: { label: "Falhou — toque para retomar", cls: "bg-terracotta-50 text-terracotta-600" },
};

export function Dashboard() {
  const lessons = useQuery(api.lessons.list);
  const due = useQuery(api.srs.dueCards);
  const streakInfo = useQuery(api.streak.get);
  const remove = useMutation(api.lessons.remove);

  const profile = useQuery(api.profiles.get);
  const displayName = profile?.displayName ?? "Estudante";

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl font-bold text-ink-900">
              Olá, {displayName} 👋
            </h1>
            {streakInfo && streakInfo.streak > 0 && (
              <span
                className="pill bg-terracotta-50 text-terracotta-600"
                title="Dias seguidos de estudo"
              >
                🔥 {streakInfo.streak} {streakInfo.streak === 1 ? "dia" : "dias"}
              </span>
            )}
          </div>
          <p className="mt-1 text-ink-500">
            Cole uma transcrição e transforme em aula em minutos.
          </p>
        </div>
        <Link to="/app/nova" className="btn-primary">
          ✨ Nova aula
        </Link>
      </div>

      {due !== undefined && due.length > 0 && (
        <div className="mb-8">
          <Link
            to="/app/vocabulario"
            className="card-panel flex items-center gap-4 border-l-4 border-l-terracotta-400 p-5 transition hover:shadow-md"
          >
            <span className="text-3xl">🔁</span>
            <div>
              <p className="font-serif text-lg font-semibold text-ink-900">
                {due.length} {due.length === 1 ? "flashcard venceu" : "flashcards venceram"} hoje
              </p>
              <p className="text-sm text-ink-500">
                Revise agora para não esquecer — a repetição espaçada funciona.
              </p>
            </div>
            <span className="ml-auto hidden text-sm font-semibold text-terracotta-600 sm:block">
              Revisar →
            </span>
          </Link>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-xl font-semibold text-ink-900">Suas aulas</h2>
        {lessons && lessons.length > 0 && (
          <span className="text-sm text-ink-400">
            {lessons.length} {lessons.length === 1 ? "aula" : "aulas"}
          </span>
        )}
      </div>

      {lessons === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-panel h-40 animate-pulse bg-paper-100/60" />
          ))}
        </div>
      ) : lessons.length === 0 ? (
        <div className="card-panel flex flex-col items-center px-6 py-16 text-center">
          <span className="text-4xl">🎬</span>
          <h3 className="mt-4 font-serif text-xl font-semibold text-ink-900">
            Nenhuma aula ainda
          </h3>
          <p className="mt-2 max-w-sm text-sm text-ink-500">
            Copie a transcrição de um vídeo do YouTube (botão “…” → Mostrar transcrição → copiar),
            cole aqui e deixe a IA montar tudo.
          </p>
          <Link to="/app/nova" className="btn-primary mt-6">
            Criar primeira aula
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((lesson: Doc<"lessons">) => {
            const lang = findLanguage(lesson.targetLang);
            const st = STATUS[lesson.status] ?? STATUS.draft;
            return (
              <div key={lesson._id} className="card-panel group relative p-5 transition hover:shadow-md">
                <Link
                  to={`/app/aula/${lesson._id}${
                    lesson.status === "draft" || lesson.status === "failed" ? "?process=1" : ""
                  }`}
                  className="block"
                >
                  {lesson.thumbnailUrl && (
            <img
              src={lesson.thumbnailUrl}
              alt=""
              loading="lazy"
              className="mb-3 h-24 w-full rounded-lg object-cover"
            />
          )}
          <div className="flex items-start justify-between gap-3">
                    <span className="text-2xl">{lang?.flag ?? "🌐"}</span>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-serif text-lg font-semibold text-ink-900">
                    {lesson.title}
                  </h3>
                  <p className="mt-1 text-xs text-ink-400">
                    {lesson.wordCount} palavras ·{" "}
                    {new Date(lesson.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`Excluir "${lesson.title}"? Essa ação não pode ser desfeita.`)) {
                      void remove({ id: lesson._id });
                    }
                  }}
                  className="absolute bottom-4 right-4 rounded-lg px-2 py-1 text-xs text-ink-400 opacity-0 transition hover:text-terracotta-600 group-hover:opacity-100"
                >
                  Excluir
                </button>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
