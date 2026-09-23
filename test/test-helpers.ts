import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/** A real 1x1 transparent PNG (generated with this project's own encoder). */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);

export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32),
]);

export const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(64)]);

export const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(16),
]);

export const TEXT_BYTES = Buffer.from("this is definitely not an image", "utf8");

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sightline-test-"));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function writeTempFile(dir: string, name: string, bytes: Buffer): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, bytes);
  return filePath;
}

export function toDataUri(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

/** Swallow expected stderr logging so test output stays readable. */
export function silenceConsoleErrors(): () => void {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
}
