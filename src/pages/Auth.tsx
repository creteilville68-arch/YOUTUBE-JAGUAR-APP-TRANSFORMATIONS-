import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Logo } from "../components/Logo";
import { findLanguage } from "../lib/languages";

const NATIVE_LANG_OPTIONS = [
  { value: "Portuguese (Brazil)", label: "Português (Brasil)" },
  { value: "English", label: "Inglês" },
  { value: "Spanish", label: "Espanhol" },
  { value: "French", label: "Francês" },
];

export function Auth() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const saveProfile = useMutation(api.profiles.save);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nativeLang, setNativeLang] = useState("Portuguese (Brazil)");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const returnTo = params.get("returnTo") || "/app";
  const lang = findLanguage(nativeLang);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isLoading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await signIn("password", { email, password, name, flow: "signUp" });
      } else {
        await signIn("password", { email, password, flow: "signIn" });
      }
      try {
        await saveProfile({
          displayName: name || email.split("@")[0],
          nativeLang,
          nativeLangCode: lang?.code ?? "pt-BR",
        });
      } catch {
        // best effort
      }
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace(/^Uncaught Error: /, "")
          : "Não foi possível entrar.",
      );
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper-50 texture-paper">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Link to="/">
              <Logo />
            </Link>
          </div>
          <div className="card-panel p-7">
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-paper-100 p-1">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  mode === "signin" ? "bg-card text-ink-900 shadow-sm" : "text-ink-500"
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  mode === "signup" ? "bg-card text-ink-900 shadow-sm" : "text-ink-500"
                }`}
              >
                Criar conta
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-700">
                      Seu nome
                    </label>
                    <input
                      className="field"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Como quer ser chamado?"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-700">
                      Seu idioma nativo
                    </label>
                    <select
                      className="field"
                      value={nativeLang}
                      onChange={(e) => setNativeLang(e.target.value)}
                    >
                      {NATIVE_LANG_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">E-mail</label>
                <input
                  className="field"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">Senha</label>
                <input
                  className="field"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              {error && (
                <p className="rounded-xl bg-terracotta-50 px-3.5 py-2.5 text-sm text-terracotta-600">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="btn-primary w-full py-3">
                {busy ? "Aguarde…" : mode === "signup" ? "Criar conta e começar" : "Entrar"}
              </button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-ink-400">
            {mode === "signin" ? "Novo por aqui? " : "Já tem conta? "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-terracotta-600 hover:underline"
            >
              {mode === "signin" ? "Criar conta grátis" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
