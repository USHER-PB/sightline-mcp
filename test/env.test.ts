import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "os";
import { join, resolve } from "path";
import {
  DEFAULT_WATCH_FOLDER,
  expandHomePath,
  readOptionalEnv,
  readPositiveIntEnv,
  resolveCacheFile,
  resolveWatchFolder,
  resolveWatchFolders,
} from "../src/env.js";
import { silenceConsoleErrors } from "./test-helpers.js";

test("readOptionalEnv treats missing and blank values as unset", () => {
  assert.equal(readOptionalEnv("MISSING", {}), undefined);
  assert.equal(readOptionalEnv("BLANK", { BLANK: "   " }), undefined);
  assert.equal(readOptionalEnv("SET", { SET: " value " }), "value");
});

test("readPositiveIntEnv reads valid integers and applies the fallback otherwise", () => {
  assert.equal(readPositiveIntEnv("N", 100, { N: "42" }), 42);
  assert.equal(readPositiveIntEnv("N", 100, {}), 100);

  const restore = silenceConsoleErrors();
  try {
    // Regression guard: a malformed value must not poison the result with NaN.
    assert.equal(readPositiveIntEnv("N", 100, { N: "abc" }), 100);
    assert.equal(readPositiveIntEnv("N", 100, { N: "0" }), 100);
    assert.equal(readPositiveIntEnv("N", 100, { N: "-5" }), 100);
    assert.equal(readPositiveIntEnv("N", 100, { N: "1.5" }), 100);
    assert.ok(Number.isInteger(readPositiveIntEnv("N", 100, { N: "1.5" })));
  } finally {
    restore();
  }
});

test("resolveWatchFolder defaults to ~/.sightline/images", () => {
  assert.equal(resolveWatchFolder({}), DEFAULT_WATCH_FOLDER);
  assert.ok(DEFAULT_WATCH_FOLDER.startsWith("/"), "default folder must be absolute");
});

test("resolveWatchFolder resolves a configured relative path", () => {
  assert.equal(resolveWatchFolder({ SIGHTLINE_WATCH_FOLDER: "./shots" }), resolve("./shots"));
});

test("expandHomePath expands a leading tilde and leaves other paths alone", () => {
  assert.equal(expandHomePath("~"), homedir());
  assert.equal(expandHomePath("~/shots"), join(homedir(), "shots"));
  assert.equal(expandHomePath("~\\shots"), join(homedir(), "shots"));
  assert.equal(expandHomePath("/abs/shots"), "/abs/shots");
  assert.equal(expandHomePath("./shots"), "./shots");
  // A tilde in the middle of a path is not home expansion.
  assert.equal(expandHomePath("a/~/b"), "a/~/b");
});

test("a tilde watch folder resolves into the real home directory", () => {
  const folders = resolveWatchFolders({ SIGHTLINE_WATCH_FOLDER: "~/screenshots" });
  assert.deepEqual(folders, [join(homedir(), "screenshots")]);
  assert.ok(!folders[0].includes("~/"), "a literal tilde folder must never be created");

  // The multi-folder form expands every entry.
  const many = resolveWatchFolders({ SIGHTLINE_WATCH_FOLDER: "~/a,~/b" });
  assert.deepEqual(many, [join(homedir(), "a"), join(homedir(), "b")]);

  assert.equal(
    resolveCacheFile({ SIGHTLINE_CACHE_FILE: "~/.sightline/custom.json" }),
    join(homedir(), ".sightline", "custom.json")
  );
});
