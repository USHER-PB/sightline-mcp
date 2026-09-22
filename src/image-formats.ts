/**
 * Single source of truth for the image formats Sightline understands.
 * Used by the folder watcher (discovery) and the image resolver (validation).
 */

export const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function normalizeExtension(filePathOrExtension: string): string {
  const lower = filePathOrExtension.trim().toLowerCase();
  if (lower.startsWith(".")) return lower;
  const lastDot = lower.lastIndexOf(".");
  return lastDot === -1 ? "" : lower.slice(lastDot);
}

export function isSupportedImageExtension(filePathOrExtension: string): boolean {
  return normalizeExtension(filePathOrExtension) in EXTENSION_TO_MIME;
}

/**
 * MIME type implied by a file extension, or null when the extension is not a
 * supported image extension.
 */
export function mimeTypeFromExtension(filePathOrExtension: string): string | null {
  return EXTENSION_TO_MIME[normalizeExtension(filePathOrExtension)] ?? null;
}

export function isSupportedImageMimeType(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/**
 * Detect the image type from the leading "magic" bytes of the payload. This is
 * what actually decides the MIME type sent to a vision backend, so a file named
 * `.png` that is really a JPEG is reported (and sent) as a JPEG.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("latin1");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
