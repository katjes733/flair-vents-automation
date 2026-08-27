import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Server tests are pure logic and stay on this faster default; client
    // tests opt into jsdom individually via a `// @vitest-environment jsdom`
    // comment at the top of the file (environmentMatchGlobs, the old way to
    // scope this by directory, was removed in Vitest v4 — this is the
    // per-file replacement).
    environment: "node",
    setupFiles: ["./src/server/bootstrap/logger-global.ts", "./tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      // datasource.ts is pure DB-connection/bootstrap wiring (schema
      // creation, TLS, synchronize()) — verified against a real Postgres
      // instance via the live smoke test in the Verification Plan, not
      // unit-testable without one. Neither reference app unit-tests this
      // layer either.
      exclude: ["src/**/*.d.ts", "src/server/database/datasource.ts"],
      reporter: ["text"],
      thresholds: {
        lines: 80,
        branches: 70,
        "src/server/domain/**": {
          lines: 90,
          branches: 90,
        },
        "src/server/control/**": {
          lines: 90,
          branches: 90,
        },
      },
    },
  },
});
