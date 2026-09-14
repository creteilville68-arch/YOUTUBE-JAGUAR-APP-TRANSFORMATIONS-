import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

type Entry = {
  term: string;
  wordClass: string;
  meanings: string[];
  contextNote: string;
  examples: { target: string; native: string }[];
};

export function WordLookup({
  word,
  sentence,
  lessonId,
  targetLang,
  nativeLang,
}: {
  word: string;
  sentence: string;
  lessonId: Id<"lessons">;
  targetLang: string;
  nativeLang: string;
}) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const lookup = useAction(api.ai.lookupWord);
  const addVocab = useMutation(api.vocab.addVocab);

  async function handleOpen() {
    setOpen(true);
    if (entry || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await lookup({
        term: word,
        contextSentence: sentence,
        targetLang,
        nativeLang,
      });
      setEntry(result.entry as Entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na consulta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="rounded px-0.5 transition hover:bg-terracotta-50 hover:text-terracotta-600"
      >
        {word}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
          <div
            className="fixed inset-0"
            onClick={() => setOpen(false)}
            aria-label="Fechar"
          />
          <div className="card-panel relative z-10 w-full max-w-md p-6">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-ink-400 hover:text-ink-700"
            >
              ✕
            </button>
            {loading && (
              <div className="flex items-center gap-3 py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-paper-300 border-t-terracotta-500" />
                <span className="text-sm text-ink-500">Consultando o dicionário…</span>
              </div>
            )}
            {error && (
              <p className="rounded-xl bg-terracotta-50 px-3.5 py-2.5 text-sm text-terracotta-600">
                {error}
              </p>
            )}
            {entry && (
              <div>
                <p className="font-serif text-2xl font-bold text-ink-900">
                  {entry.term}
                  <span className="ml-2 text-sm font-normal text-ink-400">{entry.wordClass}</span>
                </p>
                <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-ink-700">
                  {entry.meanings.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                {entry.contextNote && (
                  <p className="mt-2 rounded-lg bg-paper-100 px-3 py-2 text-xs italic text-ink-500">
                    Neste contexto: {entry.contextNote}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {entry.examples.map((ex, i) => (
                    <p key={i} className="text-sm">
                      <span className="text-ink-900">{ex.target}</span>
                      <span className="block text-xs text-ink-400">{ex.native}</span>
                    </p>
                  ))}
                </div>
                <button
                  className="btn-primary mt-4 w-full"
                  disabled={saved}
                  onClick={async () => {
                    await addVocab({
                      entry,
                      lessonId,
                      sourceSentence: sentence,
                    });
                    setSaved(true);
                  }}
                >
                  {saved ? "✓ Salvo no vocabulário" : "＋ Adicionar ao vocabulário"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
