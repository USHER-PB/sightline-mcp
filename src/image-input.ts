import { readFile, stat } from "fs/promises";
import { homedir } from "os";
import { basename, join, resolve as resolvePath } from "path";
import { errorMessage, SightlineError } from "./errors.js";
import {
  formatBytes,
  isSupportedImageMimeType,
  mimeTypeFromExtension,
  sniffImageMimeType,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./image-formats.js";

/** Environment variable that overrides the maximum accepted image size. */
export const MAX_IMAGE_BYTES_ENV = "SIGHTLINE_MAX_IMAGE_BYTES";

/** Default cap on the image payload handed to a vision backend: 10 MiB. */
export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageSource = "base64" | "data-uri" | "file" | "latest";

export interface ResolvedImage {
  /** Base64 payload, without any data URI prefix. */
  data: string;
  /** MIME type detected from the payload itself. */
  mimeType: string;
  /** Size of the decoded image, in bytes. */
  bytes: number;
  source: ImageSource;
  /** Human-readable label for tool output (file name or "inline image"). */
  label: string;
}

export interface LatestImageProvider {
  getLatestImage(): { path: string; name: string } | null;
}

export interface ResolveImageOptions {
  latestImageProvider?: LatestImageProvider;
  /** Maximum accepted size of the decoded image, in bytes. */
  maxBytes?: number;
}

const DATA_URI_PATTERN =
  /^data:([A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const BASE64_CHARS_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
/** Any real image encodes to more than this many base64 characters. */
const MIN_AUTO_BASE64_LENGTH = 64;

const INPUT_HINT =
  "Pass 'latest', an image data URI (data:image/png;base64,...), a file path (absolute, relative, or ~/...), or a raw base64 image.";

/**
 * Turn any accepted `image` tool argument into a validated payload.
 *
 * Accepted forms: "latest", an `image/*` base64 data URI, a file path, or raw
 * base64. Everything is normalized to base64 plus a sniffed MIME type, and the
 * payload is size-checked before it can be sent anywhere.
 */
export async function resolveImageInput(
  input: unknown,
  options: ResolveImageOptions = {}
): Promise<ResolvedImage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  if (typeof input !== "string" || input.trim() === "") {
    throw new SightlineError(
      "invalid_input",
      "The `image` parameter must be a non-empty string.",
      INPUT_HINT
    );
  }

  const raw = input.trim();

  if (raw.toLowerCase() === "latest") {
    const latest = options.latestImageProvider?.getLatestImage();
    if (!latest) {
      throw new SightlineError(
        "not_found",
        "No images found in the watched folder.",
        "Save a screenshot to the watched folder, or set SIGHTLINE_WATCH_FOLDER to the folder you save images to."
      );
    }
    return readImageFile(latest.path, maxBytes, "latest");
  }

  if (/^data:/i.test(raw)) {
    return decodeDataUri(raw, maxBytes);
  }

  // Long strings in the base64 alphabet are raw image payloads; shorter ones
  // are far more likely to be file paths, which are resolved below.
  if (raw.length >= MIN_AUTO_BASE64_LENGTH && BASE64_CHARS_PATTERN.test(raw)) {
    const decoded = Buffer.from(raw.replace(/\s+/g, ""), "base64");
    const mimeType = sniffImageMimeType(decoded);
    if (mimeType) {
      assertWithinLimit(decoded.length, maxBytes, "inline image");
      return {
        data: decoded.toString("base64"),
        mimeType,
        bytes: decoded.length,
        source: "base64",
        label: "inline image",
      };
    }
  }

  return readImageFile(expandHome(raw), maxBytes, "file");
}

function decodeDataUri(raw: string, maxBytes: number): ResolvedImage {
  const match = DATA_URI_PATTERN.exec(raw);
  if (!match) {
    throw new SightlineError(
      "invalid_input",
      "Invalid image data URI.",
      `Expected format: data:image/png;base64,<base64 payload>. ${INPUT_HINT}`
    );
  }

  const declaredMime = match[1].toLowerCase();
  if (!isSupportedImageMimeType(declaredMime)) {
    throw new SightlineError(
      "unsupported_media",
      `Unsupported image type "${declaredMime}".`,
      supportedFormatsHint()
    );
  }

  const decoded = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const mimeType = sniffImageMimeType(decoded);
  if (!mimeType) {
    throw unrecognizedImage(decoded, declaredMime);
  }

  assertWithinLimit(decoded.length, maxBytes, "inline image");

  return {
    data: decoded.toString("base64"),
    mimeType,
    bytes: decoded.length,
    source: "data-uri",
    label: "inline image",
  };
}

async function readImageFile(
  filePath: string,
  maxBytes: number,
  source: "file" | "latest"
): Promise<ResolvedImage> {
  const absolutePath = resolvePath(filePath);

  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch (error) {
    throw new SightlineError(
      "not_found",
      `Cannot read image file "${absolutePath}": ${errorMessage(error)}`,
      INPUT_HINT
    );
  }

  if (!fileStats.isFile()) {
    throw new SightlineError("invalid_input", `"${absolutePath}" is not a regular file.`, INPUT_HINT);
  }

  assertWithinLimit(fileStats.size, maxBytes, absolutePath);

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    throw new SightlineError(
      "not_found",
      `Cannot read image file "${absolutePath}": ${errorMessage(error)}`,
      INPUT_HINT
    );
  }

  const mimeType = sniffImageMimeType(buffer);
  if (!mimeType) {
    throw unrecognizedImage(buffer, mimeTypeFromExtension(absolutePath));
  }

  return {
    data: buffer.toString("base64"),
    mimeType,
    bytes: buffer.length,
    source,
    label: basename(absolutePath),
  };
}

function expandHome(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

function assertWithinLimit(bytes: number, maxBytes: number, label: string): void {
  if (bytes <= maxBytes) return;
  throw new SightlineError(
    "too_large",
    `Image "${label}" is ${formatBytes(bytes)}, which exceeds the ${formatBytes(maxBytes)} limit.`,
    `Increase ${MAX_IMAGE_BYTES_ENV} (in bytes) if you need to send larger images.`
  );
}

function unrecognizedImage(buffer: Buffer, declaredMime: string | null): SightlineError {
  const declared = declaredMime ? ` The input claims to be "${declaredMime}".` : "";
  const preview = buffer.subarray(0, 8).toString("hex");
  return new SightlineError(
    "unsupported_media",
    `Unrecognized image format (first bytes: ${preview}).${declared}`,
    supportedFormatsHint()
  );
}

function supportedFormatsHint(): string {
  return `Supported formats: ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}. SVG and HEIC are not supported.`;
}

