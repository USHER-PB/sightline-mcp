import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  OllamaVisionBackend,
} from "../src/ollama-backend.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function withFakeFetch(
  handler: (url: string, init?: RequestInit) => Response
): { calls: RecordedCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("posts the prompt and image to Ollama and returns the description", async () => {
  const fake = withFakeFetch(() => jsonResponse({ response: "a cat on a keyboard" }));

  try {
    const backend = new OllamaVisionBackend({ baseUrl: "http://ollama.test:1234", model: "llava" });
    const description = await backend.describe("BASE64DATA", "describe this", "image/png");

    assert.equal(description, "a cat on a keyboard");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, "http://ollama.test:1234/api/generate");
    assert.deepEqual(JSON.parse(String(fake.calls[0].init?.body)), {
      model: "llava",
      prompt: "describe this",
      images: ["BASE64DATA"],
      stream: false,
    });
  } finally {
    fake.restore();
  }
});

test("falls back to a placeholder when Ollama returns no text", async () => {
  const fake = withFakeFetch(() => jsonResponse({}));

  try {
    const backend = new OllamaVisionBackend();
    assert.equal(await backend.describe("BASE64DATA", "prompt"), "No response from Ollama");
  } finally {
    fake.restore();
  }
});

test("surfaces HTTP errors from Ollama", async () => {
  const fake = withFakeFetch(
    () => new Response("model 'llava' not found", { status: 404, statusText: "Not Found" })
  );

  try {
    const backend = new OllamaVisionBackend();
    await assert.rejects(
      () => backend.describe("BASE64DATA", "prompt"),
      /Ollama API error \(404\): model 'llava' not found/
    );
  } finally {
    fake.restore();
  }
});

test("turns connection failures into an actionable message", async () => {
  const fake = withFakeFetch(() => {
    throw new TypeError("fetch failed");
  });

  try {
    const backend = new OllamaVisionBackend({ baseUrl: "http://localhost:11434" });
    await assert.rejects(
      () => backend.describe("BASE64DATA", "prompt"),
      /Ollama not running at http:\/\/localhost:11434\. Start Ollama with: ollama serve/
    );
  } finally {
    fake.restore();
  }
});

test("probe reports whether the configured vision model is installed", async () => {
  const installed = withFakeFetch(() =>
    jsonResponse({ models: [{ name: "moondream:latest" }, { name: "llama3:8b" }] })
  );

  try {
    const backend = new OllamaVisionBackend({ model: "moondream" });
    assert.equal(await backend.probe(), true);
    assert.deepEqual(await backend.listModels(), ["moondream:latest"]);
  } finally {
    installed.restore();
  }

  const missing = withFakeFetch(() => jsonResponse({ models: [{ name: "llama3:8b" }] }));
  try {
    const backend = new OllamaVisionBackend({ model: "moondream" });
    assert.equal(await backend.probe(), false);
    assert.deepEqual(await backend.listModels(), []);
  } finally {
    missing.restore();
  }
});

test("probe returns false when Ollama is unreachable or erroring", async () => {
  const unreachable = withFakeFetch(() => {
    throw new TypeError("fetch failed");
  });

  try {
    assert.equal(await new OllamaVisionBackend().probe(), false);
  } finally {
    unreachable.restore();
  }

  const erroring = withFakeFetch(() => new Response("boom", { status: 500 }));
  try {
    assert.equal(await new OllamaVisionBackend().probe(), false);
  } finally {
    erroring.restore();
  }
});

test("reads the base URL and model from the environment by default", async () => {
  const previousUrl = process.env.OLLAMA_BASE_URL;
  const previousModel = process.env.OLLAMA_VISION_MODEL;
  const fake = withFakeFetch(() => jsonResponse({ response: "ok" }));

  try {
    process.env.OLLAMA_BASE_URL = "http://env-ollama:9999";
    process.env.OLLAMA_VISION_MODEL = "bakllava";

    const backend = new OllamaVisionBackend();
    assert.equal(backend.baseURL, "http://env-ollama:9999");
    assert.equal(backend.visionModel, "bakllava");

    await backend.describe("BASE64DATA", "prompt");
    assert.equal(fake.calls[0].url, "http://env-ollama:9999/api/generate");
  } finally {
    fake.restore();
    if (previousUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = previousUrl;
    if (previousModel === undefined) delete process.env.OLLAMA_VISION_MODEL;
    else process.env.OLLAMA_VISION_MODEL = previousModel;
  }
});

test("falls back to documented defaults", () => {
  const previousUrl = process.env.OLLAMA_BASE_URL;
  const previousModel = process.env.OLLAMA_VISION_MODEL;

  try {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_VISION_MODEL;

    const backend = new OllamaVisionBackend();
    assert.equal(backend.baseURL, DEFAULT_OLLAMA_BASE_URL);
    assert.equal(backend.visionModel, DEFAULT_OLLAMA_MODEL);
  } finally {
    if (previousUrl !== undefined) process.env.OLLAMA_BASE_URL = previousUrl;
    if (previousModel !== undefined) process.env.OLLAMA_VISION_MODEL = previousModel;
  }
});
