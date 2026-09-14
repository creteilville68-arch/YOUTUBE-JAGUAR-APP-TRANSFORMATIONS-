import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useConvexAuth } from "convex/react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-paper-300 border-t-terracotta-500" />
          <p className="text-sm text-ink-500">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?returnTo=${returnTo}`} replace />;
  }

  return <>{children}</>;
}
