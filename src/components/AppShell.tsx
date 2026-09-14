import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { Logo } from "./Logo";

const NAV = [
  { to: "/app", label: "Minhas aulas", icon: "📚", end: true },
  { to: "/app/nova", label: "Nova aula", icon: "✨" },
  { to: "/app/vocabulario", label: "Vocabulário", icon: "🗂️" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-paper-50 texture-paper">
      <header className="no-print sticky top-0 z-30 border-b border-paper-200 bg-paper-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <NavLink to="/app" className="flex items-center gap-2">
            <Logo />
          </NavLink>
          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-terracotta-50 text-terracotta-600"
                      : "text-ink-500 hover:bg-paper-100 hover:text-ink-700"
                  }`
                }
              >
                <span className="mr-1.5">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={() => {
                void signOut();
                navigate("/");
              }}
              className="ml-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-ink-400 transition hover:text-terracotta-600"
            >
              Sair
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
