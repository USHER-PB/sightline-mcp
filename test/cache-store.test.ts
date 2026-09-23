import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  CACHE_FILE_ENV,
  CACHE_PERSIST_ENV,
  CACHE_FILE_VERSION,
  FileCacheStore,
} from "../src/cache-store.js";
import { createImageCacheFromEnv, ImageCache } from "../src/cache.js";
import { cleanupTempDir, createTempDir, silenceConsoleErrors } from "./test-helpers.js";

const ENTRY = {
  key: "abc123",
  prompt: "describe this",
  description: "a screenshot of a form",
  mimeType: "image/png",
  timestamp: 1_000,
};

test("FileCacheStore round-trips entries through save and load", async () => {
  const dir = await createTempDir();
  try {
    const store = new FileCacheStore(join(dir, "nested", "cache.json"));
    store.save([ENTRY]);

    assert.ok(existsSync(store.path));
    const loaded = store.load();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], ENTRY);

    // The file carries a version so old formats can be detected later.
    const raw = JSON.parse(readFileSync(store.path, "utf8"));
    assert.equal(raw.version, CACHE_FILE_VERSION);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("FileCacheStore load returns [] when the file does not exist", async () => {
  const dir = await createTempDir();
  try {
    const store = new FileCacheStore(join(dir, "missing.json"));
    assert.deepEqual(store.load(), []);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("FileCacheStore ignores corrupt files instead of throwing", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  try {
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{ this is not json", "utf8");
    assert.deepEqual(new FileCacheStore(path).load(), []);

    writeFileSync(path, JSON.stringify({ version: 1, entries: "not-an-array" }), "utf8");
    assert.deepEqual(new FileCacheStore(path).load(), []);

    // Malformed entries are dropped; valid ones survive.
    writeFileSync(
      path,
      JSON.stringify({ version: 1, entries: [{ ...ENTRY }, { junk: true }, null] }),
      "utf8"
    );
    assert.deepEqual(new FileCacheStore(path).load(), [ENTRY]);
  } finally {
    restore();
    await cleanupTempDir(dir);
  }
});

test("save leaves no temporary file behind when it succeeds", async () => {
  const dir = await createTempDir();
  try {
    const store = new FileCacheStore(join(dir, "cache.json"));
    store.save([ENTRY]);
    assert.equal(existsSync(`${store.path}.tmp`), false);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("results survive a restart when persistence is on", async () => {
  const dir = await createTempDir();
  try {
    const path = join(dir, "cache.json");

    const first = new ImageCache({ store: new FileCacheStore(path) });
    first.set("image-bytes", "prompt", "remember me", "image/png");
    first.flush();

    // A brand-new instance hydrating from the same file sees the entry.
    const second = new ImageCache({ store: new FileCacheStore(path) });
    const entry = second.get("image-bytes", "prompt");
    assert.ok(entry, "the entry must survive the restart");
    assert.equal(entry.description, "remember me");
    assert.equal(second.hasPersistence(), true);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("hydrated entries that expired while the process was down are dropped", async () => {
  const dir = await createTempDir();
  try {
    const path = join(dir, "cache.json");
    const store = new FileCacheStore(path);
    store.save([{ ...ENTRY, timestamp: 0 }]);

    let now = 10_000_000;
    const cache = new ImageCache({ store, ttlMs: 1_000, now: () => now });
    assert.equal(cache.get(ENTRY.key, ENTRY.prompt), null);
    assert.equal(cache.stats().size, 0);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("hasPersistence reflects whether a store is configured", () => {
  assert.equal(new ImageCache().hasPersistence(), false);
  assert.equal(new ImageCache({ store: new FileCacheStore("/tmp/unused.json") }).hasPersistence(), true);
});

test("createImageCacheFromEnv disables persistence with the env flag", () => {
  const restore = silenceConsoleErrors();
  try {
    const off = createImageCacheFromEnv({
      [CACHE_PERSIST_ENV]: "0",
      [CACHE_FILE_ENV]: "/tmp/never-written.json",
    });
    assert.equal(off.hasPersistence(), false);

    const on = createImageCacheFromEnv({
      [CACHE_PERSIST_ENV]: "1",
      [CACHE_FILE_ENV]: "/tmp/sightline-test-cache.json",
    });
    assert.equal(on.hasPersistence(), true);
  } finally {
    restore();
  }
});
