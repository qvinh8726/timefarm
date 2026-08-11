import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { AuthProvider } from "./lib/auth";
import { AppStoreProvider } from "./lib/state";
import "./analytics.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AppStoreProvider>
          <App />
        </AppStoreProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
