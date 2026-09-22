import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GEMINI_MODEL, GeminiVisionBackend } from "../src/gemini-backend.js";
import { VisionBackend } from "../src/vision-backend.js";

test("requires an API key", () => {
  assert.throws(() => new GeminiVisionBackend({ apiKey: "" }), /GEMINI_API_KEY is required/);
});

test("exposes its name and needs no startup probe", () => {
  const backend: VisionBackend = new GeminiVisionBackend({ apiKey: "test-key" });

  assert.equal(backend.name, "Gemini");
  assert.equal(backend.probe, undefined);
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-2.5-flash");
});
