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

// A file run_python's sandbox wrote under /output — see codeExecWorker.mjs's
// collectOutputFiles(). `bytes` survives the worker->main-thread postMessage
// as a real Uint8Array (Node's worker_threads structured-clones typed
// arrays), not a base64 string.
export interface CodeExecFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

interface WorkerResult {
  ok: boolean;
  out: string;
  error?: string;
  files: CodeExecFile[];
}

function runInWorker(lang: "python" | "javascript", code: string): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: { lang, code },
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_LIMIT_MB },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, out: "", error: `Timed out after ${TIMEOUT_MS / 1000}s.`, files: [] });
    }, TIMEOUT_MS);

    worker.once("message", (msg: WorkerResult) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(msg);
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, out: "", error: err instanceof Error ? err.message : String(err), files: [] });
    });
  });
}

export interface PythonRunResult {
  text: string;
  files: CodeExecFile[];
}

export async function runPython(code: string): Promise<PythonRunResult> {
  const result = await runInWorker("python", code);
  const text = !result.ok
    ? `Error: ${result.error ?? "execution failed"}`
    : result.out.trim()
      ? result.out
      : "(no output — use print()/console.log() to produce output)";
  return { text, files: result.ok ? result.files : [] };
}

export async function runJavaScript(code: string): Promise<string> {
  const result = await runInWorker("javascript", code);
  if (!result.ok) return `Error: ${result.error ?? "execution failed"}`;
  return result.out.trim() ? result.out : "(no output — use print()/console.log() to produce output)";
}
