import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join, relative } from "path";
import { SightlineError } from "../src/errors.js";
import { DEFAULT_MAX_IMAGE_BYTES, resolveImageInput } from "../src/image-input.js";
import {
  cleanupTempDir,
  createTempDir,
  JPEG_BYTES,
  PNG_BYTES,
  TEXT_BYTES,
  toDataUri,
  writeTempFile,
} from "./test-helpers.js";

async function expectError(
  action: () => Promise<unknown>,
  code: SightlineError["code"]
): Promise<SightlineError> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof SightlineError)) {
      assert.fail(`expected a SightlineError, received: ${String(error)}`);
    }
    assert.equal(error.code, code);
    return error;
  }

  throw new Error(`expected the call to fail with "${code}"`);
}

test("resolves a base64 data URI", async () => {
  const image = await resolveImageInput(toDataUri("image/png", PNG_BYTES));

  assert.equal(image.mimeType, "image/png");
  assert.equal(image.source, "data-uri");
  assert.equal(image.label, "inline image");
  assert.equal(image.bytes, PNG_BYTES.length);
  assert.equal(image.data, PNG_BYTES.toString("base64"));
});

test("trusts the payload over the declared type", async () => {
  const image = await resolveImageInput(toDataUri("image/png", JPEG_BYTES));
  assert.equal(image.mimeType, "image/jpeg");
});

test("rejects a data URI that is not base64 encoded", async () => {
  const error = await expectError(
    () => resolveImageInput("data:image/png,not-base64"),
    "invalid_input"
  );
  assert.match(error.hint ?? "", /data:image\/png;base64,/);
});

test("rejects an unsupported declared type", async () => {
  const error = await expectError(
    () => resolveImageInput(toDataUri("image/svg+xml", PNG_BYTES)),
    "unsupported_media"
  );
  assert.match(error.message, /image\/svg\+xml/);
});

test("rejects a data URI whose payload is not an image", async () => {
  const error = await expectError(
    () => resolveImageInput(toDataUri("image/png", TEXT_BYTES)),
    "unsupported_media"
  );
  assert.match(error.hint ?? "", /image\/png/);
});

test("resolves raw base64 input and detects its type", async () => {
  const image = await resolveImageInput(PNG_BYTES.toString("base64"));

  assert.equal(image.source, "base64");
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.bytes, PNG_BYTES.length);
});

test("rejects empty and non-string input", async () => {
  await expectError(() => resolveImageInput(""), "invalid_input");
  await expectError(() => resolveImageInput("   "), "invalid_input");
  await expectError(() => resolveImageInput(undefined), "invalid_input");
  await expectError(() => resolveImageInput({ path: "x.png" }), "invalid_input");
});

test("resolves the most recent image from the provider", async () => {
  const dir = await createTempDir();
  try {
    const filePath = await writeTempFile(dir, "shot.png", PNG_BYTES);
    const image = await resolveImageInput("latest", {
      latestImageProvider: { getLatestImage: () => ({ path: filePath, name: "shot.png" }) },
    });

    assert.equal(image.source, "latest");
    assert.equal(image.label, "shot.png");
    assert.equal(image.mimeType, "image/png");
  } finally {
    await cleanupTempDir(dir);
  }
});

test("reports a missing watched-folder image clearly", async () => {
  const error = await expectError(
    () => resolveImageInput("latest", { latestImageProvider: { getLatestImage: () => null } }),
    "not_found"
  );
  assert.match(error.hint ?? "", /SIGHTLINE_WATCH_FOLDER/);
});

test("resolves absolute, ./relative, and bare relative file paths", async () => {
  const dir = await createTempDir();
  try {
    const absolutePath = await writeTempFile(dir, "shot.png", PNG_BYTES);
    const relativePath = relative(process.cwd(), absolutePath);

    const fromAbsolute = await resolveImageInput(absolutePath);
    const fromRelative = await resolveImageInput(`./${relativePath}`);
    const fromBareRelative = await resolveImageInput(relativePath);

    for (const image of [fromAbsolute, fromRelative, fromBareRelative]) {
      assert.equal(image.source, "file");
      assert.equal(image.label, "shot.png");
      assert.equal(image.mimeType, "image/png");
      assert.equal(image.bytes, PNG_BYTES.length);
    }
  } finally {
    await cleanupTempDir(dir);
  }
});

test("expands ~ in file paths", async () => {
  const error = await expectError(() => resolveImageInput("~/sightline-missing-image.png"), "not_found");
  assert.match(error.message, new RegExp(join(homedir(), "sightline-missing-image.png")));
});

test("reports a missing file as not_found with guidance", async () => {
  const error = await expectError(() => resolveImageInput("./does-not-exist.png"), "not_found");
  assert.match(error.message, /does-not-exist\.png/);
  assert.match(error.hint ?? "", /latest/);
});

test("rejects a directory", async () => {
  const dir = await createTempDir();
  try {
    const nested = join(dir, "folder.png");
    await mkdir(nested);
    const error = await expectError(() => resolveImageInput(nested), "invalid_input");
    assert.match(error.message, /not a regular file/);
  } finally {
    await cleanupTempDir(dir);
  }
});


test("enforces the maximum image size for files", async () => {
  const dir = await createTempDir();
  try {
    const filePath = await writeTempFile(dir, "big.png", Buffer.concat([PNG_BYTES, Buffer.alloc(4096)]));
    const error = await expectError(() => resolveImageInput(filePath, { maxBytes: 1024 }), "too_large");
    assert.match(error.hint ?? "", /SIGHTLINE_MAX_IMAGE_BYTES/);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("enforces the maximum image size for inline base64", async () => {
  const padded = Buffer.concat([PNG_BYTES, Buffer.alloc(4096)]);
  const error = await expectError(
    () => resolveImageInput(toDataUri("image/png", padded), { maxBytes: 1024 }),
    "too_large"
  );
  assert.match(error.message, /inline image/);
});

test("defaults to a 10 MiB limit", () => {
  assert.equal(DEFAULT_MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});

test("rejects a file whose contents do not match its extension", async () => {
  const dir = await createTempDir();
  try {
    const filePath = await writeTempFile(dir, "not-really.png", TEXT_BYTES);
    const error = await expectError(() => resolveImageInput(filePath), "unsupported_media");
    assert.match(error.message, /image\/png/);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("rejects unsupported file types", async () => {
  const dir = await createTempDir();
  try {
    const filePath = await writeTempFile(dir, "notes.txt", TEXT_BYTES);
    const error = await expectError(() => resolveImageInput(filePath), "unsupported_media");
    assert.match(error.hint ?? "", /SVG and HEIC are not supported/);
  } finally {
    await cleanupTempDir(dir);
  }
});

test("resolves gif and webp payloads", async () => {
  const dir = await createTempDir();
  try {
    const gif = await writeTempFile(dir, "anim.gif", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]));
    const webp = await writeTempFile(
      dir,
      "photo.webp",
      Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])
    );

    assert.equal((await resolveImageInput(gif)).mimeType, "image/gif");
    assert.equal((await resolveImageInput(webp)).mimeType, "image/webp");
  } finally {
    await cleanupTempDir(dir);
  }
});
