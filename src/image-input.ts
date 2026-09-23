import { readFile, stat } from "fs/promises";
import { basename, resolve as resolvePath } from "path";
import { expandHomePath } from "./env.js";
import { errorMessage, SightlineError } from "./errors.js";
import { CropRegion } from "./png.js";
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
  /** Newest-first list, used to resolve `latest:N` selectors. */
  listImages(): { path: string; name: string }[];
}

export interface ResolveImageOptions {
  latestImageProvider?: LatestImageProvider;
  /** Maximum accepted size of the decoded image, in bytes. */
  maxBytes?: number;
}

/** Maximum number of images in a single `compare_images` call. */
export const MAX_IMAGES_PER_REQUEST = 8;

const DATA_URI_PATTERN =
  /^data:([A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const BASE64_CHARS_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
/** Any real image encodes to more than this many base64 characters. */
const MIN_AUTO_BASE64_LENGTH = 64;
const LATEST_PATTERN = /^latest(?::(\d+))?$/i;

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

  if (LATEST_PATTERN.test(raw)) {
    return readImageFile(resolveLatestSelector(raw, options.latestImageProvider), maxBytes, "latest");
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

  return readImageFile(expandHomePath(raw), maxBytes, "file");
}

/**
 * Resolve a `latest` / `latest:N` selector (N is 1-based, 1 = most recent).
 */
function resolveLatestSelector(selector: string, provider?: LatestImageProvider): string {
  const match = LATEST_PATTERN.exec(selector);
  const index = match?.[1] ? Number(match[1]) : 1;

  const images = provider?.listImages() ?? [];

  if (images.length === 0) {
    throw new SightlineError(
      "not_found",
      "No images found in the watched folder(s).",
      "Save a screenshot to the watched folder, or set SIGHTLINE_WATCH_FOLDER to the folder you save images to."
    );
  }

  if (index < 1 || index > images.length) {
    throw new SightlineError(
      "invalid_input",
      `Selector "${selector}" is out of range: only ${images.length} image(s) are available.`,
      "Use \"latest\" for the most recent image, or \"latest:2\" for the one before it."
    );
  }

  return images[index - 1].path;
}

/**
 * Resolve a list of images for a multi-image request (comparison). Duplicate
 * inputs are rejected, since comparing an image with itself is always a
 * mistake.
 */
export async function resolveImageInputs(
  input: unknown,
  options: ResolveImageOptions = {}
): Promise<ResolvedImage[]> {
  if (!Array.isArray(input)) {
    throw new SightlineError(
      "invalid_input",
      "The `images` parameter must be an array of image references.",
      `Pass between 2 and ${MAX_IMAGES_PER_REQUEST} entries: ${INPUT_HINT}`
    );
  }

  if (input.length < 2) {
    throw new SightlineError(
      "invalid_input",
      "At least 2 images are required to compare.",
      `Pass between 2 and ${MAX_IMAGES_PER_REQUEST} entries.`
    );
  }

  if (input.length > MAX_IMAGES_PER_REQUEST) {
    throw new SightlineError(
      "invalid_input",
      `Too many images: ${input.length} (maximum ${MAX_IMAGES_PER_REQUEST}).`,
      "Compare fewer images per call, or run several comparisons."
    );
  }

  const images = await Promise.all(input.map((entry) => resolveImageInput(entry, options)));

  const seen = new Map<string, string>();
  for (const image of images) {
    const existing = seen.get(image.data);
    if (existing) {
      throw new SightlineError(
        "invalid_input",
        `Duplicate image in the comparison: "${image.label}" appears more than once${existing === image.label ? "" : ` (same bytes as "${existing}")`}.`,
        "Pass distinct images to compare."
      );
    }
    seen.set(image.data, image.label);
  }

  return images;
}

/**
 * Validate a crop/zoom rectangle coming from a tool call.
 */
export function parseRegion(value: unknown): CropRegion {
  if (value === undefined || value === null) {
    throw new SightlineError("invalid_input", "A region must be provided.");
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SightlineError(
      "invalid_input",
      "The `region` must be an object with x, y, width, and height.",
      "Example: {\"x\": 100, \"y\": 40, \"width\": 320, \"height\": 200}"
    );
  }

  const record = value as Record<string, unknown>;
  const region = {
    x: Number(record.x),
    y: Number(record.y),
    width: Number(record.width),
    height: Number(record.height),
  };

  for (const [key, number] of Object.entries(region)) {
    if (!Number.isFinite(number) || number < 0) {
      throw new SightlineError(
        "invalid_input",
        `Region "${key}" must be a non-negative number (received ${JSON.stringify(record[key])}).`
      );
    }
  }

  if (region.width < 1 || region.height < 1) {
    throw new SightlineError(
      "invalid_input",
      "Region width and height must be at least 1 pixel.",
      "Example: {\"x\": 100, \"y\": 40, \"width\": 320, \"height\": 200}"
    );
  }

  return region;
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

