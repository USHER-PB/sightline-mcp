/**
 * PNG codec (8-bit, non-interlaced) used for region crops and for returning
 * images to the client. Implemented on top of node:zlib so the server keeps
 * working with zero image-processing dependencies.
 *
 * Supported input variants: bit depth 8, no interlacing, colour types 0 (gray),
 * 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA). Anything else is rejected
 * with a clear message rather than producing corrupt pixels.
 */
import { deflateSync, inflateSync } from "zlib";
import { SightlineError } from "./errors.js";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA pixels, 4 bytes per pixel, row-major. */
  data: Buffer;
}

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const SUPPORTED_COLOR_TYPES = [0, 2, 3, 4, 6];
const MAX_DIMENSION = 20000;

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export function decodePng(buffer: Buffer): RgbaImage {
  if (!isPng(buffer)) {
    throw new SightlineError("unsupported_media", "Not a PNG file (missing PNG signature).");
  }

  const header = readHeader(buffer);
  const raw = inflateSync(header.idat);

  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  const stride = header.width * channels;
  const expected = (stride + 1) * header.height;

  if (raw.length < expected) {
    throw new SightlineError(
      "unsupported_media",
      `PNG data is truncated (expected ${expected} bytes of scanlines, found ${raw.length}).`
    );
  }

  const pixels = unfilter(raw, header.width, header.height, channels, stride);
  return { width: header.width, height: header.height, data: toRgba(pixels, header, channels) };
}

export function encodePng(image: RgbaImage): Buffer {
  if (image.width <= 0 || image.height <= 0) {
    throw new SightlineError("invalid_input", "Image dimensions must be positive.");
  }
  if (image.data.length !== image.width * image.height * 4) {
    throw new SightlineError("invalid_input", "Pixel buffer size does not match the image dimensions.");
  }

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);

  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk("IHDR", ihdr),
    buildChunk("IDAT", deflateSync(raw)),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Extract a rectangular region. The region must lie inside the image; the
 * caller is expected to pass coordinates that came from the same image.
 */
export function cropImage(image: RgbaImage, region: CropRegion): RgbaImage {
  const x = Math.round(region.x);
  const y = Math.round(region.y);
  const width = Math.round(region.width);
  const height = Math.round(region.height);

  if (width < 1 || height < 1) {
    throw new SightlineError(
      "invalid_input",
      `Crop region must be at least 1x1 pixel (received ${width}x${height}).`
    );
  }

  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) {
    throw new SightlineError(
      "invalid_input",
      `Crop region ${width}x${height} at (${x}, ${y}) exceeds the image bounds (${image.width}x${image.height}).`,
      "Use coordinates inside the image; the origin (0, 0) is the top-left corner."
    );
  }

  const out = Buffer.alloc(width * height * 4);

  for (let row = 0; row < height; row++) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    image.data.copy(out, row * width * 4, sourceStart, sourceStart + width * 4);
  }

  return { width, height, data: out };
}

interface PngHeader {
  width: number;
  height: number;
  colorType: number;
  idat: Buffer;
  palette: Buffer | null;
}

function readHeader(buffer: Buffer): PngHeader {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Buffer | null = null;
  const idatParts: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;

    if (dataStart + length + 4 > buffer.length) {
      throw new SightlineError("unsupported_media", `PNG chunk "${type}" is truncated.`);
    }

    const data = buffer.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      if (length < 13) throw new SightlineError("unsupported_media", "PNG IHDR chunk is too short.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];

      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new SightlineError(
          "unsupported_media",
          `Unsupported PNG dimensions: ${width}x${height}.`
        );
      }
      if (bitDepth !== 8) {
        throw new SightlineError(
          "unsupported_media",
          `Unsupported PNG bit depth ${bitDepth}. Only 8-bit PNGs can be cropped.`
        );
      }
      if (!SUPPORTED_COLOR_TYPES.includes(colorType)) {
        throw new SightlineError(
          "unsupported_media",
          `Unsupported PNG colour type ${colorType}. Supported: grayscale, RGB, palette, grayscale+alpha, RGBA.`
        );
      }
      if (interlace !== 0) {
        throw new SightlineError(
          "unsupported_media",
          "Interlaced (Adam7) PNGs are not supported. Re-save the image without interlacing."
        );
      }
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4;
  }

  if (colorType === -1 || idatParts.length === 0) {
    throw new SightlineError("unsupported_media", "PNG is missing its IHDR or IDAT chunk.");
  }
  if (colorType === 3 && (!palette || palette.length < 3)) {
    throw new SightlineError("unsupported_media", "Palette PNG is missing its PLTE chunk.");
  }

  return { width, height, colorType, idat: Buffer.concat(idatParts), palette };
}


function unfilter(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
  stride: number
): Buffer {
  const out = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);

  void width;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const row = raw.subarray(rowStart, rowStart + stride);
    const current = out.subarray(y * stride, (y + 1) * stride);

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;

      switch (filter) {
        case 0:
          current[i] = row[i];
          break;
        case 1:
          current[i] = (row[i] + left) & 0xff;
          break;
        case 2:
          current[i] = (row[i] + up) & 0xff;
          break;
        case 3:
          current[i] = (row[i] + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (row[i] + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new SightlineError("unsupported_media", `Unknown PNG filter type ${filter}.`);
      }
    }

    previous = current;
  }

  return out;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}
/**
 * Expand the decoded scanlines into a uniform RGBA buffer so every downstream
 * operation deals with one pixel format.
 */
function toRgba(pixels: Buffer, header: PngHeader, channels: number): Buffer {
  const pixelCount = header.width * header.height;
  const rgba = Buffer.alloc(pixelCount * 4);

  for (let index = 0; index < pixelCount; index++) {
    const source = index * channels;
    const target = index * 4;

    switch (header.colorType) {
      case 6:
        pixels.copy(rgba, target, source, source + 4);
        break;
      case 2:
        pixels.copy(rgba, target, source, source + 3);
        rgba[target + 3] = 0xff;
        break;
      case 4: {
        const gray = pixels[source];
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = pixels[source + 1];
        break;
      }
      case 0: {
        const gray = pixels[source];
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        rgba[target + 3] = 0xff;
        break;
      }
      case 3: {
        const paletteOffset = pixels[source] * 3;
        rgba[target] = header.palette?.[paletteOffset] ?? 0;
        rgba[target + 1] = header.palette?.[paletteOffset + 1] ?? 0;
        rgba[target + 2] = header.palette?.[paletteOffset + 2] ?? 0;
        rgba[target + 3] = 0xff;
        break;
      }
      default:
        throw new SightlineError(
          "unsupported_media",
          `Unsupported PNG colour type ${header.colorType}.`
        );
    }
  }

  return rgba;
}

function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

let crcTable: number[] | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}


