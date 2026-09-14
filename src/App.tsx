import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Landing } from "./pages/Landing";
import { Auth } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { NewLesson } from "./pages/NewLesson";
import { LessonView } from "./pages/LessonView";
import { Vocabulary } from "./pages/Vocabulary";
import { RequireAuth } from "./components/RequireAuth";
import { setNeuralSynthesizer } from "./lib/speech";

export default function App() {
  // Wire the neural voice once: speak() call sites stay unchanged, the lib
  // transparently prefers server-synthesized Gemini audio (falls back to the
  // browser's Web Speech voices on error or when the user opts out).
  const synthesize = useAction(api.tts.synthesize);
  useEffect(() => {
    setNeuralSynthesizer(async ({ text, lang, voice }) => {
      const r = await synthesize({ text, lang, voice });
      return { audio: r.audio, mimeType: r.mimeType };
    });
    return () => setNeuralSynthesizer(null);
  }, [synthesize]);

  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/app/nova"
        element={
          <RequireAuth>
            <NewLesson />
          </RequireAuth>
        }
      />
      <Route
        path="/app/aula/:id"
        element={
          <RequireAuth>
            <LessonView />
          </RequireAuth>
        }
      />
      <Route
        path="/app/vocabulario"
        element={
          <RequireAuth>
            <Vocabulary />
          </RequireAuth>
        }
      />
    </Routes>
    </ErrorBoundary>
  );
}
