import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // Match Next's JSX runtime, so .tsx under test needs no React import.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers: 1,
    // Many tests start a fresh PGlite database and run every migration,
    // which can pass the 5 s default on a loaded machine or CI runner.
    testTimeout: 20_000,
  },
});
