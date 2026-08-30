// Deliberately plain JS, not TypeScript under src/ — this file is loaded
// directly by node:worker_threads via a filesystem path (see
// src/lib/tools/codeExec.ts), never through Next's bundler. Two genuinely
// sandboxed engines: Pyodide (CPython compiled to WASM) for Python, and
// QuickJS-WASM for JavaScript. Neither is given any host binding (no
// require, no fetch, no fs) — isolation holds by construction, not by
// policy, and was confirmed live: inside the QuickJS context, typeof
// process/require/fetch are all "undefined".
import { parentPort, workerData } from "node:worker_threads";

const OUTPUT_LIMIT = 20000;

function truncate(text) {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[…output truncated…]` : text;
}

async function runPython(code) {
  const { loadPyodide } = await import("pyodide");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");

  // loadPyodide()'s default asset-path auto-detection breaks under this dev
  // server (resolves to node_modules/src/js/pyodide.asm.mjs instead of
  // node_modules/pyodide/...) — passing indexURL explicitly fixes it. Using
  // import.meta.resolve("pyodide") to compute it seemed to work at first but
  // turned out to be flaky: Turbopack's dev server intermittently replaces
  // import.meta.resolve with a broken internal stub
  // (__TURBOPACK__import$2e$meta__.resolve is not a function), non-
  // deterministically, in files reached via node:worker_threads. Plain
  // relative-path math from this file's own known location on disk (this
  // file lives at <repo>/workers/codeExecWorker.mjs, pyodide's package root
  // is <repo>/node_modules/pyodide) avoids import.meta.resolve entirely and
  // has been reliable across repeated test runs where the resolve()-based
  // version was not.
  const indexURL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "pyodide");
  const pyodide = await loadPyodide({ indexURL });

  let out = "";
  pyodide.setStdout({ batched: (s) => { out += s + "\n"; } });
  pyodide.setStderr({ batched: (s) => { out += s + "\n"; } });

  // Fetches Pyodide's own pre-built WASM wheels for imported packages
  // (numpy, pandas, …) before running — Magi's server deciding what to
  // load from detected imports, not the sandboxed code reaching the
  // network itself (the executed code still has no fetch/socket access).
  await pyodide.loadPackagesFromImports(code);
  await pyodide.runPythonAsync(code);
  return truncate(out);
}

async function runJavaScript(code) {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  let out = "";
  const captured = (...args) => {
    out += args.map((a) => vm.dump(a)).join(" ") + "\n";
  };
  const logHandle = vm.newFunction("log", captured);
  const errorHandle = vm.newFunction("error", captured);
  const consoleHandle = vm.newObject();
  vm.setProp(consoleHandle, "log", logHandle);
  vm.setProp(consoleHandle, "error", errorHandle);
  vm.setProp(vm.global, "console", consoleHandle);
  consoleHandle.dispose();
  logHandle.dispose();
  errorHandle.dispose();

  try {
    const result = vm.evalCode(code);
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    }
    result.value.dispose();
    return truncate(out);
  } finally {
    vm.dispose();
  }
}

try {
  const out = workerData.lang === "python" ? await runPython(workerData.code) : await runJavaScript(workerData.code);
  parentPort.postMessage({ ok: true, out });
} catch (err) {
  parentPort.postMessage({ ok: false, out: "", error: err instanceof Error ? err.message : String(err) });
}
