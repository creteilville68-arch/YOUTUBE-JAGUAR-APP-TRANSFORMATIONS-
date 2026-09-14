import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Logo } from "../components/Logo";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const FEATURES = [
  {
    icon: "📝",
    title: "Estudo frase por frase",
    text: "Cada trecho do vídeo vira um cartão com explicação no idioma original, tradução completa e vocabulário-chave contextualizado.",
  },
  {
    icon: "🎧",
    title: "Leitura acompanhada",
    text: "Todas as frases em sequência, com áudio de alta qualidade para treinar escuta e fluência no seu ritmo.",
  },
  {
    icon: "🗂️",
    title: "Dicionário sob demanda",
    text: "Toque em qualquer palavra para ver classe gramatical, todos os significados e exemplos reais — e salve num clique.",
  },
  {
    icon: "🔁",
    title: "Flashcards com repetição espaçada",
    text: "Algoritmo SM-2 que agenda suas revisões no momento certo, com exemplos gerados no seu nível CEFR (A1–C2).",
  },
  {
    icon: "📄",
    title: "PDF para estudar offline",
    text: "Exporte a aula completa formatada para impressão, ou copie todo o texto quando precisar.",
  },
  {
    icon: "🌍",
    title: "10 idiomas",
    text: "Inglês, espanhol, francês, alemão, italiano, japonês, coreano, mandarim, português e russo.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Copie a transcrição",
    text: "No YouTube: “…” → Mostrar transcrição → copiar. São só dois toques.",
  },
  {
    n: "2",
    title: "Cole no LínguaViva",
    text: "A IA restaura a pontuação, divide em frases e monta a aula completa automaticamente.",
  },
  {
    n: "3",
    title: "Estude do seu jeito",
    text: "Frase por frase, leitura com áudio, PDF ou flashcards — tudo salvo na sua conta.",
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-paper-50 texture-paper">
      {/* Header */}
      <header className="border-b border-paper-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-ink-700 transition hover:text-terracotta-600 sm:block"
            >
              Entrar
            </Link>
            <Link to="/auth?mode=signup" className="btn-primary">
              Começar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <p className="pill mb-5 bg-sage-100 text-sage-600">
            🎬 De vídeo do YouTube a aula de idioma
          </p>
          <h1 className="font-serif text-4xl font-bold leading-[1.1] tracking-tight text-ink-900 sm:text-6xl">
            Transforme qualquer vídeo em uma{" "}
            <span className="relative whitespace-nowrap text-terracotta-500">
              aula viva
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 200 9"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 7C60 2 140 2 198 6"
                  stroke="#d97f4e"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.45"
                />
              </svg>
            </span>{" "}
            de idioma
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-500">
            Cole a transcrição e receba tradução frase por frase, vocabulário com múltiplos
            significados, leitura acompanhada com áudio, PDF para estudar offline e flashcards
            com repetição espaçada. Em qualquer um dos 10 idiomas.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link to="/auth?mode=signup" className="btn-primary px-7 py-3 text-base">
              Criar minha primeira aula →
            </Link>
            <Link to="/auth" className="btn-secondary px-7 py-3 text-base">
              Já tenho conta
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-400">
            Grátis para começar · sem cartão de crédito
          </p>
        </motion.div>

        {/* Hero mock */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          className="mt-14"
        >
          <div className="card-panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-paper-200 bg-paper-100/60 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-terracotta-400/70" />
              <span className="h-3 w-3 rounded-full bg-paper-300" />
              <span className="h-3 w-3 rounded-full bg-paper-300" />
              <span className="ml-3 text-xs font-medium text-ink-400">
                Aula · Entrevista em espanhol
              </span>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <div className="rounded-xl border border-paper-200 bg-paper-50 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-terracotta-600">
                  🇪🇸 Frase 3
                </p>
                <p className="font-serif text-lg text-ink-900">
                  “La diferencia es que antes no teníamos esta tecnología.”
                </p>
                <p className="mt-2 text-sm text-ink-500">
                  A diferença é que antes não tínhamos essa tecnologia.
                </p>
              </div>
              <div className="rounded-xl border border-paper-200 bg-card p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sage-600">
                  Vocabulário
                </p>
                <p className="font-serif font-semibold text-ink-900">
                  diferencia <span className="text-xs font-normal text-ink-400">· sustantivo</span>
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  diferença · desacordo · “hacer la diferencia” = fazer a diferença
                </p>
                <div className="mt-3 flex gap-2">
                  <span className="pill bg-terracotta-50 text-terracotta-600">🔊 Ouvir</span>
                  <span className="pill bg-sage-100 text-sage-600">＋ Salvar</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="border-y border-paper-200 bg-paper-100/50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.h2 {...fadeUp} className="font-serif text-3xl font-bold text-ink-900">
            Como funciona
          </motion.h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                className="card-panel p-6"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-terracotta-500 font-serif text-base font-bold text-white">
                  {s.n}
                </span>
                <h3 className="mt-4 font-serif text-lg font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{s.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <motion.h2 {...fadeUp} className="font-serif text-3xl font-bold text-ink-900">
          Tudo que uma aula precisa
        </motion.h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: (i % 3) * 0.07 }}
              className="card-panel p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="text-2xl">{f.icon}</span>
              <h3 className="mt-3 font-serif text-lg font-semibold text-ink-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <motion.div
          {...fadeUp}
          className="rounded-3xl bg-ink-900 px-6 py-14 text-center sm:px-12"
        >
          <h2 className="font-serif text-3xl font-bold text-paper-50 sm:text-4xl">
            Seu próximo vídeo é a sua próxima aula.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-paper-200/90">
            Crie sua conta gratuita, cole uma transcrição e estude com conteúdo que você
            realmente quer entender.
          </p>
          <Link
            to="/auth?mode=signup"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-terracotta-400 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition hover:bg-terracotta-500"
          >
            Começar agora — é grátis
          </Link>
        </motion.div>
      </section>

      <footer className="border-t border-paper-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-ink-400 sm:flex-row sm:px-6">
          <Logo />
          <p>Feito para quem aprende idiomas com vídeos reais.</p>
        </div>
      </footer>
    </div>
  );
}
