import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (PDF text extraction, src/lib/files/extractText.ts) bundles
  // pdfjs-dist and @napi-rs/canvas, which the dev/build bundler can't trace
  // worker/native-binary paths through correctly — run them unbundled instead.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default nextConfig;
