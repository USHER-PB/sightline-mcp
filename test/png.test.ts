import { test } from "node:test";
import assert from "node:assert/strict";
import { cropImage, decodePng, encodePng, isPng, RgbaImage } from "../src/png.js";
import { SightlineError } from "../src/errors.js";
import { JPEG_BYTES, PNG_BYTES, TEXT_BYTES } from "./test-helpers.js";

/** Build a solid-colour RGBA image of the given size. */
function solidImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}

test("isPng recognizes the PNG signature only", () => {
  assert.equal(isPng(PNG_BYTES), true);
  assert.equal(isPng(JPEG_BYTES), false);
  assert.equal(isPng(TEXT_BYTES), false);
  assert.equal(isPng(Buffer.alloc(0)), false);
});

test("decodePng reads a real PNG", () => {
  const image = decodePng(PNG_BYTES);
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.equal(image.data.length, 4);
});

test("encodePng/decodePng round-trips pixels exactly", () => {
  const original: RgbaImage = {
    width: 3,
    height: 2,
    data: Buffer.from([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255,
      10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 200,
    ]),
  };

  const decoded = decodePng(encodePng(original));
  assert.equal(decoded.width, original.width);
  assert.equal(decoded.height, original.height);
  assert.deepEqual([...decoded.data], [...original.data]);
});

test("decodePng rejects non-PNG input with unsupported_media", () => {
  assert.throws(
    () => decodePng(JPEG_BYTES),
    (error: unknown) => error instanceof SightlineError && error.code === "unsupported_media"
  );
  assert.throws(
    () => decodePng(TEXT_BYTES),
    (error: unknown) => error instanceof SightlineError && error.code === "unsupported_media"
  );
});

test("encodePng validates dimensions and buffer size", () => {
  assert.throws(
    () => encodePng({ width: 0, height: 1, data: Buffer.alloc(0) }),
    (error: unknown) => error instanceof SightlineError && error.code === "invalid_input"
  );
  assert.throws(
    () => encodePng({ width: 2, height: 2, data: Buffer.alloc(3) }),
    (error: unknown) => error instanceof SightlineError && error.code === "invalid_input"
  );
});

test("cropImage extracts the requested region", () => {
  // 4x4 image, left half red and right half blue.
  const image = { width: 4, height: 4, data: Buffer.alloc(4 * 4 * 4) } as RgbaImage;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const offset = (y * 4 + x) * 4;
      if (x < 2) {
        image.data[offset] = 255;
      } else {
        image.data[offset + 2] = 255;
      }
      image.data[offset + 3] = 255;
    }
  }

  const right = cropImage(image, { x: 2, y: 0, width: 2, height: 4 });
  assert.equal(right.width, 2);
  assert.equal(right.height, 4);
  // First cropped pixel comes from (2,0): blue, not red.
  assert.equal(right.data[0], 0);
  assert.equal(right.data[2], 255);

  const topLeft = cropImage(image, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(topLeft.width, 1);
  assert.equal(topLeft.data[0], 255);
});

test("cropImage rejects a region outside the image", () => {
  const image = solidImage(2, 2, [0, 0, 0, 255]);
  assert.throws(
    () => cropImage(image, { x: 1, y: 1, width: 5, height: 5 }),
    (error: unknown) => error instanceof SightlineError && error.code === "invalid_input"
  );
  assert.throws(
    () => cropImage(image, { x: 0, y: 0, width: 0, height: 1 }),
    (error: unknown) => error instanceof SightlineError && error.code === "invalid_input"
  );
});
