import { test } from "node:test";
import assert from "node:assert/strict";
import { cropResolvedImage, sanitizeFileName } from "../src/crop.js";
import { ResolvedImage } from "../src/image-input.js";
import { SightlineError } from "../src/errors.js";
import { JPEG_BYTES, PNG_BYTES } from "./test-helpers.js";

function resolved(bytes: Buffer, mimeType: string, label: string): ResolvedImage {
  return {
    data: bytes.toString("base64"),
    mimeType,
    bytes: bytes.length,
    source: "file",
    label,
  };
}

test("cropResolvedImage crops a PNG and reports the source size", () => {
  const result = cropResolvedImage(resolved(PNG_BYTES, "image/png", "shot.png"), {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });

  assert.equal(result.source.width, 1);
  assert.equal(result.source.height, 1);
  assert.equal(result.region.width, 1);
  assert.equal(result.region.height, 1);
  assert.equal(result.image.mimeType, "image/png");
  assert.equal(result.image.bytes, result.png.length);
  assert.ok(result.image.label.includes("shot.png"));
  assert.ok(result.image.label.includes("region 1x1"));
  // The returned bytes must decode as a PNG.
  assert.deepEqual([...result.png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("cropResolvedImage refuses non-PNG input with a hint", () => {
  assert.throws(
    () => cropResolvedImage(resolved(JPEG_BYTES, "image/jpeg", "photo.jpg"), {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }),
    (error: unknown) =>
      error instanceof SightlineError &&
      error.code === "unsupported_media" &&
      (error.hint ?? "").includes("PNG")
  );
});

test("sanitizeFileName strips extensions and unsafe characters", () => {
  assert.equal(sanitizeFileName("My Screenshot (1).png"), "My-Screenshot-1");
  // Path separators, dots, and traversal fragments must never survive into a
  // file name that will be joined onto the watched folder.
  assert.equal(sanitizeFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeFileName("my.photo.v2.png"), "my-photo-v2");
  assert.equal(sanitizeFileName("---"), "image");
  assert.equal(sanitizeFileName(""), "image");
  assert.ok(sanitizeFileName("a".repeat(200)).length <= 60);
});
