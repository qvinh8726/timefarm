import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Electron loads the production renderer from file://. Relative asset URLs
  // are required there; an absolute /assets path resolves to the drive root
  // and produces a blank window in the packaged app.
  base: "./",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom")
          )
            return "react";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/@js-temporal")) return "temporal";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**/*.ts",
        "src/lib/persistence.ts",
        "src/lib/state.tsx",
        "src/lib/auth.tsx",
        "src/lib/clock.ts",
      ],
      thresholds: {
        lines: 58,
        functions: 54,
        statements: 56,
        branches: 43,
        "src/domain/**/*.ts": {
          lines: 85,
          functions: 84,
          statements: 84,
          branches: 73,
        },
        "src/lib/persistence.ts": {
          lines: 92,
          functions: 100,
          statements: 90,
          branches: 77,
        },
        "src/lib/state.tsx": {
          lines: 29,
          functions: 28,
          statements: 27,
          branches: 12,
        },
        "src/lib/auth.tsx": {
          lines: 58,
          functions: 57,
          statements: 56,
          branches: 18,
        },
        "src/lib/clock.ts": {
          lines: 86,
          functions: 66,
          statements: 80,
          branches: 75,
        },
      },
    },
  },
});
