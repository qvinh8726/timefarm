import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("TimeFarm renderer crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error-card">
          <span className="eyebrow">TIMEFARM RECOVERY</span>
          <h1>TimeFarm couldn’t render this screen.</h1>
          <p>
            Your local database was not cleared. Reload the interface; if the
            problem remains, keep the error below for support.
          </p>
          <pre>{this.state.error.message}</pre>
          <button
            type="button"
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload TimeFarm
          </button>
        </div>
      </main>
    );
  }
}
