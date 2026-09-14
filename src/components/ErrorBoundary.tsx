import { Component, ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Catches render-time crashes so a bad lesson document can never blank the
// whole app again — the user sees the message and a way back instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-paper-50 px-4">
          <div className="card-panel max-w-md p-6 text-center">
            <span className="text-3xl">😵</span>
            <p className="mt-3 font-serif text-lg font-semibold text-ink-900">
              Algo deu errado nesta tela
            </p>
            <p className="mt-1 break-words text-sm text-ink-500">{this.state.error.message}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-secondary" onClick={() => this.setState({ error: null })}>
                Tentar de novo
              </button>
              <a className="btn-primary" href="/app">
                Ir para Minhas aulas
              </a>
            </div>
            <p className="mt-3 text-xs text-ink-400">
              Se persistir após recarregar a página, me avise no chat — o erro acima ajuda a
              identificar a causa.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
