import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes,
  isSupportedImageExtension,
  isSupportedImageMimeType,
  mimeTypeFromExtension,
  sniffImageMimeType,
} from "../src/image-formats.js";
import { GIF_BYTES, JPEG_BYTES, PNG_BYTES, TEXT_BYTES, WEBP_BYTES } from "./test-helpers.js";

test("recognizes supported image extensions, case-insensitively", () => {
  assert.ok(isSupportedImageExtension("shot.png"));
  assert.ok(isSupportedImageExtension("shot.JPEG"));
  assert.ok(isSupportedImageExtension("shot.webp"));
  assert.ok(!isSupportedImageExtension("notes.txt"));
  assert.ok(!isSupportedImageExtension("diagram.svg"));
  assert.ok(!isSupportedImageExtension("archive"));
});

test("maps extensions to MIME types", () => {
  assert.equal(mimeTypeFromExtension("/tmp/shot.png"), "image/png");
  assert.equal(mimeTypeFromExtension("shot.jpg"), "image/jpeg");
  assert.equal(mimeTypeFromExtension("shot.jpeg"), "image/jpeg");
  assert.equal(mimeTypeFromExtension("shot.gif"), "image/gif");
  assert.equal(mimeTypeFromExtension("shot.webp"), "image/webp");
  assert.equal(mimeTypeFromExtension("shot.txt"), null);
  assert.equal(mimeTypeFromExtension("shot"), null);
});

test("knows which MIME types are supported", () => {
  assert.ok(isSupportedImageMimeType("image/png"));
  assert.ok(isSupportedImageMimeType("IMAGE/WEBP"));
  assert.ok(!isSupportedImageMimeType("image/svg+xml"));
  assert.ok(!isSupportedImageMimeType("text/plain"));
});

test("sniffs MIME types from magic bytes", () => {
  assert.equal(sniffImageMimeType(PNG_BYTES), "image/png");
  assert.equal(sniffImageMimeType(JPEG_BYTES), "image/jpeg");
  assert.equal(sniffImageMimeType(GIF_BYTES), "image/gif");
  assert.equal(sniffImageMimeType(WEBP_BYTES), "image/webp");
});

test("returns null for payloads that are not images", () => {
  assert.equal(sniffImageMimeType(TEXT_BYTES), null);
  assert.equal(sniffImageMimeType(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")), null);
  assert.equal(sniffImageMimeType(Buffer.alloc(0)), null);
});

test("formats byte sizes for humans", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});
