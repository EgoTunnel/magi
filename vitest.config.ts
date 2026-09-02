import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // Each test file gets its own temp database, created by this setup file
    // before the file's imports run — db.ts opens its connection at import
    // time, so the env var has to be set first.
    setupFiles: ["./tests/setup.ts"],
    // Files must not share a database: db.ts caches its connection on
    // globalThis, and SQLite writes from parallel workers would interleave.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});
