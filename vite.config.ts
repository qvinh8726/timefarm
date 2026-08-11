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
      include: ["src/domain/**/*.ts", "src/lib/persistence.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 45,
      },
    },
  },
});
