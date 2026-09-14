import { Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Landing } from "./pages/Landing";
import { Auth } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { NewLesson } from "./pages/NewLesson";
import { LessonView } from "./pages/LessonView";
import { Vocabulary } from "./pages/Vocabulary";
import { RequireAuth } from "./components/RequireAuth";

export default function App() {
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
