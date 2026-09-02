import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Runs once per test file, before that file's imports. src/lib/db.ts opens its
// connection at import time and reads MAGI_DATA_DIR, so this is what keeps the
// suite off the real data/magi.db — a throwaway directory per file, deleted
// afterwards.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "magi-test-"));
process.env.MAGI_DATA_DIR = dir;

// No key is ever set, so nothing can reach a real provider even by accident:
// every network-touching path in Magi checks for one and degrades. The
// pipelines under test get a fake provider instead (tests/helpers/provider.ts).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.TAVILY_API_KEY;

afterAll(async () => {
  // Windows won't unlink a file SQLite still has open, so the connection is
  // closed first. The import is dynamic so a test file that never touches the
  // database doesn't open one just to tear it down.
  try {
    const { db } = await import("@/lib/db");
    db.close();
  } catch {
    // no database was opened
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a green suite over.
  }
});
