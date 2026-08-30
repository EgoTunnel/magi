import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (PDF text extraction, src/lib/files/extractText.ts) bundles
  // pdfjs-dist and @napi-rs/canvas, which the dev/build bundler can't trace
  // worker/native-binary paths through correctly — run them unbundled instead.
  // pyodide (run_python, workers/codeExecWorker.mjs) has the same problem —
  // it loads its WASM/data assets by a runtime-computed indexURL, which
  // Turbopack can't statically trace ("Cannot find module as expression is
  // too dynamic"). quickjs-emscripten is included alongside it defensively,
  // for the same reason.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "pyodide", "quickjs-emscripten"],
};

export default nextConfig;
