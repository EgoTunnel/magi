// Orchestrates the sandboxed run_python/run_javascript tools — see
// workers/codeExecWorker.mjs for the actual sandboxed execution. Every run
// gets a fresh worker thread (simpler and more isolated than a shared warm
// worker, at the cost of ~1-2s of Pyodide cold-start per Python call) and a
// hard wall-clock timeout enforced via worker.terminate(), which was
// confirmed live to kill even a synchronous WASM infinite loop.
import { Worker } from "node:worker_threads";
import path from "node:path";

const WORKER_FILE = path.join(process.cwd(), "workers", "codeExecWorker.mjs");
const TIMEOUT_MS = 15000;
const MEMORY_LIMIT_MB = 512;

interface WorkerResult {
  ok: boolean;
  out: string;
  error?: string;
}

function runInWorker(lang: "python" | "javascript", code: string): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: { lang, code },
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_LIMIT_MB },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, out: "", error: `Timed out after ${TIMEOUT_MS / 1000}s.` });
    }, TIMEOUT_MS);

    worker.once("message", (msg: WorkerResult) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(msg);
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, out: "", error: err instanceof Error ? err.message : String(err) });
    });
  });
}

async function run(lang: "python" | "javascript", code: string): Promise<string> {
  const result = await runInWorker(lang, code);
  if (!result.ok) return `Error: ${result.error ?? "execution failed"}`;
  return result.out.trim() ? result.out : "(no output — use print()/console.log() to produce output)";
}

export function runPython(code: string): Promise<string> {
  return run("python", code);
}

export function runJavaScript(code: string): Promise<string> {
  return run("javascript", code);
}
