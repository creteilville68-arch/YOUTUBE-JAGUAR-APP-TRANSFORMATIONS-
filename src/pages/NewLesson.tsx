import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppShell } from "../components/AppShell";
import { LANGUAGES } from "../lib/languages";

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Draft persistence: the dev preview reloads the page on file changes (HMR is
// disabled by the platform), so the form must survive reloads. Restored on
// mount, cleared only after the lesson is created.
const DRAFT_KEY = "nova-aula-draft";
type Draft = {
  title: string;
  url: string;
  transcript: string;
  thumbnailUrl: string;
  targetLang: string;
  nativeLang: string;
  manualGuide: { videoId: string; reason: string } | null;
};

function loadDraft(): Partial<Draft> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

// Mirror of the server-side parser (tiny) so manually pasted transcripts
// still get linked to the video for the synced-video tab.
function parseVideoId(url: string): string | null {
  const raw = url.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch {
    /* not a url */
  }
  return null;
}

export function NewLesson() {
  const navigate = useNavigate();
  const create = useMutation(api.lessons.createSplit);
  const fetchTranscript = useAction(api.youtube.fetchTranscript);
  const saved = useMemo(loadDraft, []);
  const [title, setTitle] = useState(saved.title ?? "");
  const [url, setUrl] = useState(saved.url ?? "");
  const [transcript, setTranscript] = useState(saved.transcript ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState(saved.thumbnailUrl ?? "");
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState("");
  const [manualGuide, setManualGuide] = useState<{ videoId: string; reason: string } | null>(
    saved.manualGuide ?? null,
  );
  const [targetLang, setTargetLang] = useState(saved.targetLang ?? "English");
  const [nativeLang, setNativeLang] = useState(saved.nativeLang ?? "Portuguese (Brazil)");

  // Save the draft on every change so a reload never loses work.
  useEffect(() => {
    try {
      const draft: Draft = { title, url, transcript, thumbnailUrl, targetLang, nativeLang, manualGuide };
      if (title || url || transcript || thumbnailUrl || manualGuide) {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } else {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // storage full/unavailable — non-fatal
    }
  }, [title, url, transcript, thumbnailUrl, targetLang, nativeLang, manualGuide]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const words = useMemo(() => countWords(transcript), [transcript]);
  // Long transcripts become a series: "Título — Parte 1/N", … (~1.800 words/part).
  const PART_WORDS = 1800;
  const partCount = words === 0 ? 0 : Math.max(1, Math.ceil(words / PART_WORDS));

  async function handleFetch() {
    setFetchNote("");
    setError("");
    if (!url.trim()) {
      setError("Cole a URL do vídeo primeiro.");
      return;
    }
    setFetching(true);
    try {
      const result = await fetchTranscript({ url: url.trim() });
      // oEmbed metadata works even when captions are blocked — always prefill.
      if (!title.trim() && result.title) setTitle(result.title);
      if (result.thumbnailUrl) setThumbnailUrl(result.thumbnailUrl);
      if (result.status === "ok") {
        setManualGuide(null);
        setTranscript(result.text ?? "");
        setFetchNote("Transcrição importada do YouTube ✓ — revise e clique em gerar.");
      } else {
        setFetchNote("");
        setManualGuide({ videoId: result.videoId, reason: result.reason ?? "Motivo desconhecido." });
      }
    } catch (err) {
      setFetchNote("");
      setError(err instanceof Error ? err.message : "Erro ao buscar a transcrição.");
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!transcript.trim()) {
      setError("Importe pela URL ou cole a transcrição do vídeo.");
      return;
    }
    setBusy(true);
    try {
      const { ids } = await create({
        title,
        rawText: transcript,
        targetLang,
        nativeLang,
        youtubeUrl: url.trim() || undefined,
        thumbnailUrl,
        videoId: manualGuide?.videoId ?? parseVideoId(url) ?? undefined,
      });
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      navigate(`/app/aula/${ids[0]}?process=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a aula.");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Link to="/app" className="mb-6 inline-block text-sm font-medium text-ink-400 hover:text-terracotta-600">
          ← Voltar
        </Link>
        <h1 className="font-serif text-3xl font-bold text-ink-900">Nova aula</h1>
        <p className="mt-1 text-ink-500">
          Cole a transcrição de um vídeo do YouTube e a IA monta a aula completa.
        </p>

        <form onSubmit={handleSubmit} className="card-panel mt-6 space-y-5 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Título (opcional)</label>
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Entrevista sobre clima — parte 1"
            />
   [truncated]
</div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              URL do YouTube <span className="font-normal text-ink-400">(importação automática)</span>
            </label>
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                inputMode="url"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={fetching || busy}
                onClick={handleFetch}
              >
                {fetching ? "Buscando…" : "⬇ Importar"}
              </button>
            </div>
            {fetchNote && (
              <p className="mt-1.5 text-xs font-medium text-sage-600">{fetchNote}</p>
            )}
            {manualGuide && (
              <div className="mt-3 rounded-xl border border-terracotta-100 bg-terracotta-50/60 px-4 py-3.5">
                <p className="text-sm font-semibold text-terracotta-600">
                  ⚠️ {manualGuide.reason}
                </p>
                <p className="mt-1.5 text-sm text-ink-700">
                  Enquanto isso, você ainda pode gerar esta aula:{" "}
                  <a
                    className="font-semibold text-terracotta-600 hover:underline"
                    href={`https://www.youtube.com/watch?v=${manualGuide.videoId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    abra o vídeo ↗
                  </a>
                  , toque em "…" → "Mostrar transcrição", copie e cole abaixo. Título e capa
                  já foram preenchidos automaticamente.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              Transcrição <span className="font-normal text-ink-400">(preenchida automaticamente ou cole manualmente)</span>
            </label>
            <textarea
              className="field min-h-[220px] resize-y font-mono text-[13px] leading-relaxed"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={"Abra o vídeo no YouTube → botão \"…\" → Mostrar transcrição → selecione tudo e cole aqui…"}
            />
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className={partCount > 1 ? "font-semibold text-ink-700" : "text-ink-400"}>
                {words} palavras
                {partCount > 1 && ` — será dividida em ${partCount} partes`}
              </span>
              <a
                className="text-terracotta-600 hover:underline"
                href="https://support.google.com/youtube/answer/2734796?hl=pt"
                target="_blank"
                rel="noreferrer"
              >
                Como copiar a transcrição?
              </a>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">
                Idioma do vídeo
              </label>
              <select
                className="field"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">
                Traduzir para
              </label>
              <select
                className="field"
                value={nativeLang}
                onChange={(e) => setNativeLang(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {partCount > 1 && (
            <div className="rounded-xl border border-sage-100 bg-sage-100/50 px-4 py-3">
              <p className="text-sm font-semibold text-sage-600">
                📚 Vídeo longo: será criada uma série com {partCount} aulas
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                "{title.trim() || "Aula sem título"} — Parte 1/{partCount}", "Parte 2/{partCount}"…
                A Parte 1 começa a ser gerada agora; as próximas são geradas em sequência,
                e você pode acompanhar pelo painel da série dentro da aula.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-terracotta-50 px-3.5 py-2.5 text-sm text-terracotta-600">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-paper-200 pt-5">
            <p className="text-xs text-ink-400">
              Usa a camada gratuita da IA — limite diário aplicado.
            </p>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Criando…" : "Gerar aula com IA"}
            </button>
          </div>
        </form>

        <div className="mt-6 rounded-2xl border border-dashed border-paper-300 bg-paper-100/40 px-5 py-4 text-sm text-ink-500">
          <p className="font-semibold text-ink-700">💡 Dica: transcrições automáticas</p>
          <p className="mt-1">
            As transcrições automáticas do YouTube vêm sem pontuação. Não se preocupe:
            a IA restaura a pontuação antes de montar a aula.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
