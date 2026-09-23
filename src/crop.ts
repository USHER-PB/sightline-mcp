import { CropRegion, cropImage, decodePng, encodePng, isPng } from "./png.js";
import { ResolvedImage } from "./image-input.js";
import { SightlineError } from "./errors.js";

export interface CropResult {
  /** The cropped image, ready to send to a backend or save to disk. */
  image: ResolvedImage;
  /** Dimensions of the image the region was taken from. */
  source: { width: number; height: number };
  /** The validated region that was applied. */
  region: CropRegion;
  /** Encoded PNG bytes of the crop. */
  png: Buffer;
}

/**
 * Crop a resolved image (region zoom, or the `crop_image` tool).
 *
 * Cropping needs to decode the source, and this build only decodes PNG, so
 * non-PNG inputs are rejected with an explanation instead of producing
 * garbage.
 */
export function cropResolvedImage(image: ResolvedImage, region: CropRegion): CropResult {
  const source = Buffer.from(image.data, "base64");

  if (!isPng(source)) {
    throw new SightlineError(
      "unsupported_media",
      `Cropping requires a PNG image, but "${image.label}" is ${image.mimeType}.`,
      "Screenshots are usually PNG; re-save or convert this image to PNG and try again."
    );
  }

  const decoded = decodePng(source);
  const cropped = cropImage(decoded, region);
  const png = encodePng(cropped);

  return {
    image: {
      data: png.toString("base64"),
      mimeType: "image/png",
      bytes: png.length,
      source: image.source,
      label: `${image.label} [region ${cropped.width}x${cropped.height} at ${Math.round(region.x)},${Math.round(region.y)}]`,
    },
    source: { width: decoded.width, height: decoded.height },
    region,
    png,
  };
}

/**
 * Turn a label into a safe file name component.
 */
export function sanitizeFileName(label: string): string {
  const cleaned = label
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned.length > 0 ? cleaned.slice(0, 60) : "image";
}
