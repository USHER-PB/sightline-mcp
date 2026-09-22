import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "fs/promises";
import { join } from "path";
import { ImageWatcher } from "../src/image-watcher.js";
import { cleanupTempDir, createTempDir, PNG_BYTES, silenceConsoleErrors } from "./test-helpers.js";

async function writeImage(dir: string, name: string, modified: Date): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, PNG_BYTES);
  await utimes(filePath, modified, modified);
  return filePath;
}

test("indexes existing images newest-first", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  const watcher = new ImageWatcher(dir);

  try {
    await writeImage(dir, "older.png", new Date("2024-01-01T00:00:00Z"));
    await writeImage(dir, "newer.png", new Date("2024-06-01T00:00:00Z"));

    await watcher.start();

    const images = watcher.listImages();
    assert.equal(images.length, 2);
    assert.equal(images[0].name, "newer.png");
    assert.equal(images[1].name, "older.png");
    assert.equal(watcher.getLatestImage()?.name, "newer.png");
    assert.equal(watcher.path, dir);
  } finally {
    watcher.stop();
    restore();
    await cleanupTempDir(dir);
  }
});

test("refresh picks up new files and prunes deleted ones", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  // No watcher needed: refresh() rebuilds the index from the filesystem, which
  // is also what keeps list_images accurate when a watch event is missed.
  const watcher = new ImageWatcher(dir);

  try {
    const first = await writeImage(dir, "first.png", new Date("2024-01-01T00:00:00Z"));
    let result = await watcher.refresh();
    assert.equal(result.added, 1);
    assert.equal(result.total, 1);

    const second = await writeImage(dir, "second.png", new Date("2024-02-01T00:00:00Z"));
    result = await watcher.refresh();
    assert.equal(result.added, 1);
    assert.equal(result.total, 2);
    assert.equal(watcher.getLatestImage()?.name, "second.png");

    await rm(second);
    result = await watcher.refresh();
    assert.equal(result.removed, 1);
    assert.equal(result.total, 1);
    assert.equal(watcher.listImages()[0].path, first);

    // A no-change refresh reports no churn.
    result = await watcher.refresh();
    assert.deepEqual({ added: result.added, removed: result.removed }, { added: 0, removed: 0 });
  } finally {
    watcher.stop();
    restore();
    await cleanupTempDir(dir);
  }
});

test("ignores directories and unsupported files", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  const watcher = new ImageWatcher(dir);

  try {
    await mkdir(join(dir, "folder.png"));
    await writeFile(join(dir, "notes.txt"), "hello");

    await watcher.start();
    assert.equal(watcher.listImages().length, 0);
    assert.equal(watcher.getLatestImage(), null);
  } finally {
    watcher.stop();
    restore();
    await cleanupTempDir(dir);
  }
});

test("start does not throw when the folder is missing", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  const watcher = new ImageWatcher(join(dir, "missing"));

  try {
    await watcher.start();
    assert.equal(watcher.listImages().length, 0);
  } finally {
    watcher.stop();
    restore();
    await cleanupTempDir(dir);
  }
});

test("stop is idempotent and start can be called twice", async () => {
  const dir = await createTempDir();
  const restore = silenceConsoleErrors();
  const watcher = new ImageWatcher(dir);

  try {
    await writeImage(dir, "shot.png", new Date("2024-01-01T00:00:00Z"));
    await watcher.start();
    await watcher.start();

    assert.equal(watcher.listImages().length, 1);

    watcher.stop();
    watcher.stop();

    // Discovery must keep working after the watcher is torn down.
    await watcher.start();
    assert.equal(watcher.listImages().length, 1);
  } finally {
    watcher.stop();
    restore();
    await cleanupTempDir(dir);
  }
});
