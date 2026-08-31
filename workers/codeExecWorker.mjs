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
const OUTPUT_DIR = "/output";
const MAX_OUTPUT_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeTypeFor(name) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function truncate(text) {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[…output truncated…]` : text;
}

// Pyodide's filesystem (Emscripten MEMFS) is in-memory and normally
// discarded along with the whole WASM instance the moment this worker exits
// — nothing the sandboxed code writes ever reaches the host. Anything saved
// under OUTPUT_DIR is the one exception: read back and returned to the
// caller as raw bytes, which turns into a downloadable Artifact one layer up
// (see run_python's branch in src/lib/tools/registry.ts). Everything outside
// OUTPUT_DIR is still invisible and discarded exactly as before.
function collectOutputFiles(pyodide, notes) {
  const files = [];
  let entries;
  try {
    entries = pyodide.FS.readdir(OUTPUT_DIR);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    if (files.length >= MAX_OUTPUT_FILES) {
      notes.push(`(only the first ${MAX_OUTPUT_FILES} output files are kept — "${name}" and later files were skipped)`);
      break;
    }
    const fullPath = `${OUTPUT_DIR}/${name}`;
    let stat;
    try {
      stat = pyodide.FS.stat(fullPath);
    } catch {
      continue;
    }
    if (pyodide.FS.isDir(stat.mode)) continue; // one flat level is all run_python is documented to support
    let bytes;
    try {
      bytes = pyodide.FS.readFile(fullPath);
    } catch {
      continue;
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      notes.push(`("${name}" was ${Math.round(bytes.byteLength / 1024 / 1024)}MB, over the ${MAX_FILE_BYTES / 1024 / 1024}MB limit, and was not saved)`);
      continue;
    }
    files.push({ name, mimeType: mimeTypeFor(name), bytes });
  }
  return files;
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

  // The one directory the sandboxed code can actually persist anything to —
  // created before the run so plt.savefig("/output/plot.png") etc. has
  // somewhere to write. See run_python's tool description for the contract
  // told to the model.
  pyodide.FS.mkdir(OUTPUT_DIR);

  // Fetches Pyodide's own pre-built WASM wheels for imported packages
  // (numpy, pandas, …) before running — Magi's server deciding what to
  // load from detected imports, not the sandboxed code reaching the
  // network itself (the executed code still has no fetch/socket access).
  await pyodide.loadPackagesFromImports(code);

  // matplotlib's default backend expects a browser canvas; there is none
  // here, so force the standard headless renderer before any user code runs.
  // Harmless no-op (caught and ignored) when the code never touches
  // matplotlib at all.
  try {
    await pyodide.runPythonAsync('import matplotlib\nmatplotlib.use("Agg")');
  } catch {
    // matplotlib not loaded/used this run — nothing to configure
  }

  await pyodide.runPythonAsync(code);

  const notes = [];
  const files = collectOutputFiles(pyodide, notes);
  const outWithNotes = notes.length ? `${out}${out.endsWith("\n") ? "" : "\n"}${notes.join("\n")}` : out;
  return { out: truncate(outWithNotes), files };
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
  if (workerData.lang === "python") {
    const { out, files } = await runPython(workerData.code);
    parentPort.postMessage({ ok: true, out, files });
  } else {
    const out = await runJavaScript(workerData.code);
    parentPort.postMessage({ ok: true, out, files: [] });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, out: "", error: err instanceof Error ? err.message : String(err), files: [] });
}
