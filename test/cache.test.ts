import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createImageCacheFromEnv,
  DEFAULT_CACHE_MAX_SIZE,
  DEFAULT_CACHE_TTL_MS,
  ImageCache,
} from "../src/cache.js";
import { silenceConsoleErrors } from "./test-helpers.js";

test("stores and returns results for the same image and prompt", () => {
  const cache = new ImageCache();
  cache.set("image-bytes", "describe this", "a screenshot", "image/png");

  const entry = cache.get("image-bytes", "describe this");
  assert.ok(entry);
  assert.equal(entry.description, "a screenshot");
  assert.equal(entry.mimeType, "image/png");
  assert.equal(cache.stats().hits, 1);
});

test("the prompt is part of the cache key", () => {
  const cache = new ImageCache();
  cache.set("image-bytes", "ocr", "text", "image/png");

  assert.equal(cache.get("image-bytes", "describe this"), null);
  assert.ok(cache.get("image-bytes", "ocr"));
  assert.equal(cache.stats().misses, 1);
});

test("expired entries are dropped and counted", () => {
  let now = 1_000;
  const cache = new ImageCache({ ttlMs: 500, now: () => now });
  cache.set("image-bytes", "prompt", "stale", "image/png");

  now = 1_600;
  assert.equal(cache.get("image-bytes", "prompt"), null);
  assert.equal(cache.stats().size, 0);
  assert.equal(cache.stats().expirations, 1);
});

test("eviction is least-recently-used, not oldest-inserted", () => {
  const cache = new ImageCache({ maxSize: 2 });
  cache.set("a", "p", "A", "image/png");
  cache.set("b", "p", "B", "image/png");

  // Touch "a" so "b" becomes the least recently used entry.
  assert.ok(cache.get("a", "p"));
  cache.set("c", "p", "C", "image/png");

  assert.ok(cache.get("a", "p"), "recently used entry must survive");
  assert.ok(cache.get("c", "p"));
  assert.equal(cache.get("b", "p"), null, "least recently used entry must be evicted");
  assert.equal(cache.stats().evictions, 1);
  assert.equal(cache.stats().size, 2);
});

test("re-setting a key replaces its value without growing the cache", () => {
  const cache = new ImageCache({ maxSize: 5 });
  cache.set("image-bytes", "prompt", "first", "image/png");
  cache.set("image-bytes", "prompt", "second", "image/png");

  assert.equal(cache.stats().size, 1);
  const entry = cache.get("image-bytes", "prompt");
  assert.ok(entry);
  assert.equal(entry.description, "second");
});

test("the cache never exceeds its configured size", () => {
  const cache = new ImageCache({ maxSize: 3 });
  for (let i = 0; i < 10; i++) {
    cache.set(`image-${i}`, "prompt", `result ${i}`, "image/png");
  }

  assert.equal(cache.stats().size, 3);
  assert.equal(cache.stats().maxSize, 3);
  assert.equal(cache.stats().evictions, 7);
});

test("clearExpired removes only expired entries", () => {
  let now = 0;
  const cache = new ImageCache({ ttlMs: 100, now: () => now });

  cache.set("old", "prompt", "old", "image/png");
  now = 60;
  cache.set("new", "prompt", "new", "image/png");

  // 120 > 0 + 100 (expired) but 120 - 60 = 60 <= 100 (still valid).
  now = 120;
  assert.equal(cache.clearExpired(), 1);
  assert.equal(cache.stats().size, 1);
  assert.ok(cache.get("new", "prompt"));
});

test("clear empties the cache", () => {
  const cache = new ImageCache();
  cache.set("image-bytes", "prompt", "result", "image/png");
  cache.clear();
  assert.equal(cache.stats().size, 0);
});

test("startJanitor returns a stop function that is safe to call twice", () => {
  const cache = new ImageCache({ maxSize: 5, ttlMs: 10_000 });
  const stop = cache.startJanitor(1_000);
  assert.equal(typeof stop, "function");
  stop();
  stop();
});

test("createImageCacheFromEnv reads configuration from the environment", () => {
  const cache = createImageCacheFromEnv({
    SIGHTLINE_CACHE_MAX_SIZE: "5",
    SIGHTLINE_CACHE_TTL_MS: "1000",
  });

  assert.equal(cache.stats().maxSize, 5);
  assert.equal(cache.stats().ttlMs, 1_000);
});

test("createImageCacheFromEnv falls back to defaults for invalid values", () => {
  const restore = silenceConsoleErrors();
  try {
    const cache = createImageCacheFromEnv({
      SIGHTLINE_CACHE_MAX_SIZE: "not-a-number",
      SIGHTLINE_CACHE_TTL_MS: "",
    });

    assert.equal(cache.stats().maxSize, DEFAULT_CACHE_MAX_SIZE);
    assert.equal(cache.stats().ttlMs, DEFAULT_CACHE_TTL_MS);
  } finally {
    restore();
  }
});
