import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { setSetting, setEmbeddingModelId, setLocalEmbeddingBaseUrl } from "@/lib/settings";
import {
  embedTexts,
  isEmbeddingConfigured,
  listEmbeddingModels,
  resolveEmbeddingProvider,
} from "@/lib/models/embeddings";

// A stand-in for Ollama or LM Studio: the two endpoints the local provider
// actually uses, in the shape they actually return. Worth a real socket rather
// than a stubbed fetch — the point of targeting the OpenAI-compatible API is
// that an ordinary HTTP server on this machine can serve it, and a stub would
// mostly be asserting that the stub was called.
let server: http.Server;
let baseUrl: string;
let embedRequests: Array<{ model: string; input: string[]; encoding_format?: string }> = [];
// Flipped by the base64 test: a server is free to answer in base64 whatever
// format was asked for, and some do.
let respondBase64 = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Deliberately unsorted, and deliberately mixing a chat model in with the
      // embedding ones — that is what these servers really return.
      res.end(JSON.stringify({ data: [{ id: "qwen3:8b" }, { id: "nomic-embed-text" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/embeddings") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { model: string; input: string[]; encoding_format?: string };
        embedRequests.push(parsed);
        // Returned out of input order, with the authoritative index on each
        // item: providers are not required to preserve order, and the caller
        // has to re-sort rather than trust position.
        const data = parsed.input
          .map((_, i) => ({
            index: i,
            embedding: respondBase64
              ? Buffer.from(new Float32Array([i, i + 0.5]).buffer).toString("base64")
              : [i, i + 0.5],
          }))
          .reverse();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetDb();
  embedRequests = [];
  respondBase64 = false;
});

describe("embedding provider resolution", () => {
  it("routes a prefixed id to the local provider and everything else to OpenRouter", () => {
    expect(resolveEmbeddingProvider("local:nomic-embed-text")?.id).toBe("local");
    expect(resolveEmbeddingProvider("openai/text-embedding-3-small")?.id).toBe("openrouter");
    // Archives indexed before local embeddings existed store bare ids. If those
    // ever stopped resolving to OpenRouter, every vector already on disk would
    // be orphaned.
    expect(resolveEmbeddingProvider("qwen/qwen3-embedding-8b")?.id).toBe("openrouter");
  });
});

describe("isEmbeddingConfigured", () => {
  it("is false with no model chosen", () => {
    setSetting("openrouter_api_key", "sk-test");
    expect(isEmbeddingConfigured()).toBe(false);
  });

  it("follows the chosen model's own provider, not whichever key happens to be set", () => {
    setEmbeddingModelId("openai/text-embedding-3-small");
    expect(isEmbeddingConfigured()).toBe(false);
    setSetting("openrouter_api_key", "sk-test");
    expect(isEmbeddingConfigured()).toBe(true);
  });

  it("counts a local model as configured with no OpenRouter key at all", () => {
    // The whole point of the seam: an archive that stays searchable by meaning
    // when no remote provider is configured or reachable.
    setEmbeddingModelId("local:nomic-embed-text");
    setLocalEmbeddingBaseUrl(baseUrl);
    expect(isEmbeddingConfigured()).toBe(true);
  });

  it("does not count a local model as configured just because OpenRouter is", () => {
    setEmbeddingModelId("local:nomic-embed-text");
    setSetting("openrouter_api_key", "sk-test");
    expect(isEmbeddingConfigured()).toBe(false);
  });
});

describe("local embeddings", () => {
  it("embeds against an OpenAI-compatible server and restores input order", async () => {
    setLocalEmbeddingBaseUrl(baseUrl);
    const vectors = await embedTexts("local:nomic-embed-text", ["first", "second", "third"]);
    expect(vectors).toEqual([
      [0, 0.5],
      [1, 1.5],
      [2, 2.5],
    ]);
    // The prefix is Magi's own routing device and must not reach the server.
    expect(embedRequests[0].model).toBe("nomic-embed-text");
    expect(embedRequests[0].input).toEqual(["first", "second", "third"]);
    // Left unset, the OpenAI SDK asks for base64 and decodes it, which turns a
    // float-array answer into empty vectors with no error raised.
    expect(embedRequests[0].encoding_format).toBe("float");
  });

  it("decodes a base64 answer from a server that gives one anyway", async () => {
    respondBase64 = true;
    setLocalEmbeddingBaseUrl(baseUrl);
    const vectors = await embedTexts("local:nomic-embed-text", ["first", "second"]);
    expect(vectors).toEqual([
      [0, 0.5],
      [1, 1.5],
    ]);
  });

  it("refuses to embed a local model when no server is configured", async () => {
    await expect(embedTexts("local:nomic-embed-text", ["x"])).rejects.toThrow(/not configured/);
  });

  it("lists the server's models, prefixed and marked", async () => {
    setLocalEmbeddingBaseUrl(baseUrl);
    const { models, providers } = await listEmbeddingModels();
    const local = models.filter((m) => m.id.startsWith("local:"));
    expect(local.map((m) => m.id)).toEqual(["local:nomic-embed-text", "local:qwen3:8b"]);
    expect(local[0].label).toContain("(local)");
    expect(providers.find((p) => p.id === "local")).toMatchObject({ configured: true, error: null });
    // No OpenRouter key, so its catalog contributes nothing.
    expect(models.some((m) => m.id.startsWith("openai/"))).toBe(false);
  });

  it("reports an unreachable server rather than showing an empty list", async () => {
    // A port nothing is listening on: configured, but not running — which needs
    // a different fix than "not configured" and must not look the same.
    setLocalEmbeddingBaseUrl("http://127.0.0.1:1/v1");
    const { providers } = await listEmbeddingModels();
    const local = providers.find((p) => p.id === "local");
    expect(local?.configured).toBe(true);
    expect(local?.error).toBeTruthy();
  });

  it("offers both catalogs when both providers are configured", async () => {
    setLocalEmbeddingBaseUrl(baseUrl);
    setSetting("openrouter_api_key", "sk-test");
    const { models } = await listEmbeddingModels();
    expect(models.some((m) => m.id === "local:nomic-embed-text")).toBe(true);
    expect(models.some((m) => m.id === "openai/text-embedding-3-small")).toBe(true);
  });
});
