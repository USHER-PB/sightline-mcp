#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "module";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ImageWatcher } from "./image-watcher.js";
import { createImageCacheFromEnv } from "./cache.js";
import {
  buildComparisonPrompt,
  describeModes,
  getPromptForMode,
  modeImpliesJson,
  parsePromptMode,
  PROMPT_MODE_NAMES,
  PromptMode,
} from "./prompt-modes.js";
import { BackendManager, createBackendManager } from "./backend-manager.js";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES_ENV,
  MAX_IMAGES_PER_REQUEST,
  parseRegion,
  resolveImageInput,
  resolveImageInputs,
  ResolvedImage,
} from "./image-input.js";
import { cropResolvedImage, sanitizeFileName } from "./crop.js";
import {
  isOutputFormat,
  OutputFormat,
  parseJsonResponse,
  toStructuredContent,
  withJsonInstruction,
} from "./output-format.js";
import { errorMessage, isSightlineError, SightlineError } from "./errors.js";
import {
  ensureDirectory,
  readBoolEnv,
  readPositiveIntEnv,
  resolveCacheFile,
  resolveWatchFolders,
} from "./env.js";
import {
  ClipboardWatcher,
  CLIPBOARD_ENV,
  CLIPBOARD_INTERVAL_ENV,
  DEFAULT_CLIPBOARD_INTERVAL_MS,
} from "./clipboard.js";
import { formatBytes } from "./image-formats.js";

const SERVER_NAME = "sightline-mcp";
/** Crops are written to this subfolder so they never shadow real screenshots. */
const CROP_FOLDER = "derived";

/**
 * Version comes from package.json so the handshake can never drift from the
 * published package again.
 */
function readServerVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface ToolArgs {
  image?: unknown;
  images?: unknown;
  mode?: unknown;
  prompt?: unknown;
  output?: unknown;
  region?: unknown;
  limit?: unknown;
  save?: unknown;
  filename?: unknown;
}

type ToolResult = CallToolResult;

const MODE_ENUM = [...PROMPT_MODE_NAMES];
const MODE_DESCRIPTION = `Analysis mode preset. ${describeModes()} Default: 'general'.`;
const PROMPT_DESCRIPTION =
  "Optional custom prompt. When provided it replaces the mode's preset prompt entirely. Use this for specific questions like 'What error is shown?'.";

const IMAGE_DESCRIPTION =
  "The image to analyze. Accepts 'latest' or 'latest:N' (N-th most recent watched image, 1 = newest), an image data URI (data:image/png;base64,...), a file path (absolute, relative, or ~/...), or a raw base64 image.";

const OUTPUT_DESCRIPTION =
  "Response format: 'text' (default) returns prose; 'json' asks the model for JSON and returns it as MCP structured content. The 'ui-elements' mode defaults to 'json'.";

const REGION_DESCRIPTION =
  "Optional crop rectangle (pixels from the top-left corner) to analyze instead of the whole image - useful to zoom into small text. Requires a PNG image. Get coordinates from the 'ui-elements' mode.";

function text(textValue: string): ToolResult {
  return { content: [{ type: "text", text: textValue }] };
}

/**
 * Map internal failures onto the right JSON-RPC error code so a bad argument
 * is reported as a bad argument, not as a server crash.
 */
function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) return error;

  if (isSightlineError(error)) {
    const code =
      error.code === "backend_unavailable" || error.code === "internal"
        ? ErrorCode.InternalError
        : ErrorCode.InvalidParams;
    return new McpError(code, error.hint ? `${error.message}\n\n${error.hint}` : error.message);
  }

  return new McpError(ErrorCode.InternalError, `Failed to analyze image: ${errorMessage(error)}`);
}

/**
 * Resolve the `output` tool argument. Modes that only make sense as JSON
 * (e.g. ui-elements) default to "json"; anything invalid is rejected with a
 * hint listing the valid formats.
 */
function resolveOutputFormat(value: unknown, mode: PromptMode): OutputFormat {
  if (value === undefined || value === null || value === "") {
    return modeImpliesJson(mode) ? "json" : "text";
  }

  if (!isOutputFormat(value)) {
    throw new SightlineError(
      "invalid_input",
      `Unknown output format "${String(value)}".`,
      "Valid formats: text, json."
    );
  }

  return value;
}

/**
 * Render an analysis result. In "json" mode the model output is parsed
 * leniently (bare JSON, code fences, or JSON embedded in prose) and returned as
 * MCP structured content; when parsing fails the raw text is kept so an answer
 * is never lost.
 */
function renderResult(
  label: string,
  description: string,
  suffix: string,
  output: OutputFormat
): ToolResult {
  if (output === "json") {
    const parsed = parseJsonResponse(description);
    if (parsed.ok) {
      return {
        content: [{ type: "text", text: description }],
        structuredContent: toStructuredContent(parsed.value),
      };
    }
  }

  return text(`**Image: ${label}** (${suffix})\n\n${description}`);
}

function toolDefinitions() {
  return [
    {
      name: "view_image",
      description:
        "Analyze an image and return a text description. Use this tool when you need to 'see' an image - screenshots, diagrams, UI mockups, error messages, or any visual content. Returns detailed description including any visible text, UI elements, diagrams, or relevant visual information.",
      inputSchema: {
        type: "object",
        properties: {
          image: {
            type: "string",
            description: IMAGE_DESCRIPTION,
          },
          mode: {
            type: "string",
            enum: MODE_ENUM,
            description: MODE_DESCRIPTION,
            default: "general",
          },
          prompt: {
            type: "string",
            description: PROMPT_DESCRIPTION,
          },
          output: {
            type: "string",
            enum: ["text", "json"],
            description: OUTPUT_DESCRIPTION,
          },
          region: {
            type: "object",
            description: REGION_DESCRIPTION,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
        },
        required: ["image"],
      },
    },
    {
      name: "list_images",
      description:
        "List all images currently available in the watched folder. Use this to discover what screenshots or images have been captured and are ready for analysis. Returns image names, sizes, and timestamps sorted by most recent first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of images to list (default: 10)",
            default: 10,
          },
        },
      },
    },
    {
      name: "view_latest",
      description:
        "Analyze the most recent image in the watched folder. This is a convenience tool that combines list_images and view_image for the common case of analyzing the latest screenshot. Use this when the user mentions 'the screenshot', 'the image', or refers to something they just captured.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: MODE_ENUM,
            description: MODE_DESCRIPTION,
            default: "general",
          },
          prompt: {
            type: "string",
            description: PROMPT_DESCRIPTION,
          },
          output: {
            type: "string",
            enum: ["text", "json"],
            description: OUTPUT_DESCRIPTION,
          },
        },
      },
    },
    {
      name: "compare_images",
      description:
        "Compare two or more images in a single call - what is identical, what differs, and which image each statement applies to. Useful for before/after screenshots, visual regression checks, and spotting unintended changes.",
      inputSchema: {
        type: "object",
        properties: {
          images: {
            type: "array",
            items: { type: "string" },
            description: `Between 2 and ${MAX_IMAGES_PER_REQUEST} image references; each accepts the same forms as view_image's 'image' parameter.`,
            minItems: 2,
            maxItems: MAX_IMAGES_PER_REQUEST,
          },
          mode: {
            type: "string",
            enum: MODE_ENUM,
            description: MODE_DESCRIPTION,
            default: "general",
          },
          prompt: { type: "string", description: PROMPT_DESCRIPTION },
          output: { type: "string", enum: ["text", "json"], description: OUTPUT_DESCRIPTION },
        },
        required: ["images"],
      },
    },
    {
      name: "crop_image",
      description:
        "Crop a rectangular region out of a PNG image and return the crop as an image (plus a data URI). Use it to zoom into small text or isolate a UI element before analysis; view_image's 'region' parameter does the same in one step.",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: IMAGE_DESCRIPTION },
          region: {
            type: "object",
            description: "Region to extract, in pixels from the top-left corner.",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
          save: {
            type: "boolean",
            description: "Also write the crop into <watched folder>/derived/ (default: false).",
            default: false,
          },
        },
        required: ["image", "region"],
      },
    },
    {
      name: "save_image",
      description:
        "Save an image (data URI or raw base64) into the watched folder so it becomes discoverable through list_images and the 'latest' selector. The bytes are stored as-is; no analysis is performed.",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: IMAGE_DESCRIPTION },
          filename: {
            type: "string",
            description:
              "File name inside the watched folder (e.g. 'pasted-diagram.png'). The extension is normalized to the image's actual format. Defaults to sightline-<timestamp>.<ext>.",
          },
        },
        required: ["image"],
      },
    },
    {
      name: "cache_status",
      description:
        "Report cache and backend status: entry count, hits/misses, TTL, persistence, and which vision backends are currently available.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

function parseLimit(value: unknown, fallback = 10): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

async function main(): Promise<void> {
  const watchFolders = resolveWatchFolders();
  const watchFolder = watchFolders[0];
  for (const folder of watchFolders) {
    if (ensureDirectory(folder)) {
      console.error(`[Sightline] Created watch folder: ${folder}`);
    }
  }
  ensureDirectory(dirname(resolveCacheFile()));

  const maxBytes = readPositiveIntEnv(MAX_IMAGE_BYTES_ENV, DEFAULT_MAX_IMAGE_BYTES);
  const imageCache = createImageCacheFromEnv();
  const stopCacheJanitor = imageCache.startJanitor();

  const imageWatcher = new ImageWatcher(watchFolders);
  await imageWatcher.start();

  // Clipboard capture is opt-in: a clipboard can hold sensitive material.
  const clipboardIntervalMs = readPositiveIntEnv(
    CLIPBOARD_INTERVAL_ENV,
    DEFAULT_CLIPBOARD_INTERVAL_MS
  );
  let clipboardWatcher: ClipboardWatcher | null = null;
  let clipboardStatus = `off (set ${CLIPBOARD_ENV}=1 to enable)`;

  if (readBoolEnv(CLIPBOARD_ENV, false)) {
    clipboardWatcher = new ClipboardWatcher({
      folder: watchFolder,
      intervalMs: clipboardIntervalMs,
      onCapture: (image) => {
        console.error(
          `[Clipboard] Captured ${image.name} (${formatBytes(image.bytes)}, ${image.mimeType})`
        );
        void imageWatcher.refresh();
      },
    });

    clipboardStatus = (await clipboardWatcher.start())
      ? `on (${clipboardWatcher.toolName}, every ${clipboardIntervalMs}ms)`
      : "requested, but no clipboard tool found (install wl-clipboard or xclip)";
  }

  let backendManager: BackendManager;
  try {
    backendManager = await createBackendManager();
  } catch (error) {
    console.error(`[Sightline] Fatal: ${errorMessage(error)}`);
    process.exit(1);
  }

  /**
   * Analyze an already-validated image: cache first, then the backend chain.
   * view_image and view_latest share this path so the output format cannot
   * drift between them.
   */
  async function analyze(
    image: ResolvedImage,
    mode: string,
    prompt: string,
    output: OutputFormat = "text"
  ): Promise<ToolResult> {
    const effectivePrompt = output === "json" ? withJsonInstruction(prompt) : prompt;
    const cached = imageCache.get(image.data, effectivePrompt);
    if (cached) {
      return renderResult(image.label, cached.description, `${mode} mode, cached`, output);
    }

    const result = await backendManager.describe({
      prompt: effectivePrompt,
      images: [{ data: image.data, mimeType: image.mimeType, label: image.label }],
    });
    imageCache.set(image.data, effectivePrompt, result.description, image.mimeType);

    return renderResult(
      image.label,
      result.description,
      `${mode} mode, via ${result.backend}`,
      output
    );
  }

  async function handleListImages(args: ToolArgs): Promise<ToolResult> {
    const limit = parseLimit(args.limit);

    await imageWatcher.refresh();
    const images = imageWatcher.listImages().slice(0, limit);

    if (images.length === 0) {
      return text(
        `No images found in watched folder: ${watchFolder}\n\nTip: Save screenshots to this folder, or set SIGHTLINE_WATCH_FOLDER to a different path.`
      );
    }

    const imageList = images
      .map(
        (img, index) =>
          `${index + 1}. ${img.name} (${formatBytes(img.size)}, modified: ${img.modifiedAt.toISOString()})`
      )
      .join("\n");

    return text(
      `Found ${images.length} image(s) in ${watchFolder}:\n\n${imageList}\n\nUse view_image with the full path, or view_latest to analyze the most recent one.`
    );
  }

  async function handleViewImage(input: unknown, args: ToolArgs): Promise<ToolResult> {
    const mode = parsePromptMode(args.mode);
    const output = resolveOutputFormat(args.output, mode);
    const prompt = getPromptForMode(
      mode,
      typeof args.prompt === "string" ? args.prompt : undefined
    );

    // Re-index first so a screenshot saved a moment ago is visible to
    // 'latest' / 'latest:N' even when the watch event has not arrived yet.
    await imageWatcher.refresh();
    let image = await resolveImageInput(input, {
      latestImageProvider: imageWatcher,
      maxBytes,
    });

    if (args.region !== undefined && args.region !== null) {
      image = cropResolvedImage(image, parseRegion(args.region)).image;
    }

    return analyze(image, mode, prompt, output);
  }

  async function handleCompareImages(args: ToolArgs): Promise<ToolResult> {
    const mode = parsePromptMode(args.mode);
    const output = resolveOutputFormat(args.output, mode);

    await imageWatcher.refresh();
    const images = await resolveImageInputs(args.images, {
      latestImageProvider: imageWatcher,
      maxBytes,
    });

    const labels = images.map((image) => image.label);
    const prompt = buildComparisonPrompt(
      labels,
      mode,
      typeof args.prompt === "string" ? args.prompt : undefined
    );
    const effectivePrompt = output === "json" ? withJsonInstruction(prompt) : prompt;

    // A hit requires every image (in order) and the prompt to match.
    const cacheKey = images.map((image) => image.data).join("\n");
    const suffix = `${mode} mode, ${images.length} images`;

    const cached = imageCache.get(cacheKey, effectivePrompt);
    if (cached) {
      return renderResult(labels.join(", "), cached.description, `${suffix}, cached`, output);
    }

    const result = await backendManager.describe({
      prompt: effectivePrompt,
      images: images.map((image) => ({
        data: image.data,
        mimeType: image.mimeType,
        label: image.label,
      })),
    });
    imageCache.set(cacheKey, effectivePrompt, result.description, images[0].mimeType);

    return renderResult(
      labels.join(", "),
      result.description,
      `${suffix}, via ${result.backend}`,
      output
    );
  }

  async function handleCropImage(args: ToolArgs): Promise<ToolResult> {
    await imageWatcher.refresh();
    const image = await resolveImageInput(args.image, {
      latestImageProvider: imageWatcher,
      maxBytes,
    });
    const region = parseRegion(args.region);
    const crop = cropResolvedImage(image, region);

    let savedPath: string | undefined;
    if (args.save === true) {
      const derivedDir = join(watchFolder, CROP_FOLDER);
      ensureDirectory(derivedDir);
      savedPath = join(
        derivedDir,
        `${sanitizeFileName(image.label)}-${Date.now()}.png`
      );
      await writeFile(savedPath, crop.png);
    }

    const note = savedPath
      ? ` Saved to ${savedPath} (${formatBytes(crop.png.length)}).`
      : "";
    return {
      content: [
        {
          type: "text",
          text:
            `**Image: ${crop.image.label}** (crop ${crop.region.width}x${crop.region.height} ` +
            `at ${Math.round(crop.region.x)},${Math.round(crop.region.y)} of ` +
            `${crop.source.width}x${crop.source.height})${note}\n\n` +
            `Pass the data URI below to view_image to analyze the crop.`,
        },
        { type: "image", data: crop.image.data, mimeType: "image/png" },
      ],
    };
  }

  async function handleSaveImage(args: ToolArgs): Promise<ToolResult> {
    const image = await resolveImageInput(args.image, {
      latestImageProvider: imageWatcher,
      maxBytes,
    });

    const extensionByMime: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
    };
    const extension = extensionByMime[image.mimeType] ?? ".bin";
    const requested = typeof args.filename === "string" ? args.filename.trim() : "";
    // sanitizeFileName strips any extension; the sniffed one is authoritative.
    const baseName =
      requested !== "" ? sanitizeFileName(requested) : `sightline-${Date.now()}`;
    const target = join(watchFolder, `${baseName}${extension}`);

    await writeFile(target, Buffer.from(image.data, "base64"));
    await imageWatcher.refresh();

    return text(
      `**Image saved** to ${target} (${formatBytes(image.bytes)}, ${image.mimeType}).\n\n` +
        `Discoverable via list_images and the 'latest' selector.`
    );
  }

  async function handleCacheStatus(): Promise<ToolResult> {
    const stats = imageCache.stats();
    const backendLines = backendManager.describeBackends().map(
      (backend) =>
        `  ${backend.name}: ${backend.available ? "available" : `unavailable${backend.note ? ` (${backend.note})` : ""}`}`
    );

    return text(
      [
        "Cache",
        `  entries: ${stats.size} / ${stats.maxSize} (persisted: ${imageCache.hasPersistence() ? "yes" : "no"})`,
        `  hits: ${stats.hits} | misses: ${stats.misses} | evictions: ${stats.evictions} | expired: ${stats.expirations}`,
        `  ttl: ${stats.ttlMs}ms`,
        "",
        "Backends",
        ...backendLines,
      ].join("\n")
    );
  }

  const server = new Server(
    {
      name: SERVER_NAME,
      version: readServerVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as ToolArgs;

    try {
      switch (request.params.name) {
        case "list_images":
          return await handleListImages(args);
        case "view_latest":
          return await handleViewImage("latest", args);
        case "view_image":
          return await handleViewImage(args.image, args);
        case "compare_images":
          return await handleCompareImages(args);
        case "crop_image":
          return await handleCropImage(args);
        case "save_image":
          return await handleSaveImage(args);
        case "cache_status":
          return handleCacheStatus();
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      throw toMcpError(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (signal: string): void => {
    console.error(`[Sightline] Received ${signal}, shutting down.`);
    stopCacheJanitor();
    imageCache.stopPersistence(); // flush pending cache entries before exiting
    clipboardWatcher?.stop();
    imageWatcher.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  console.error("Sightline MCP server running on stdio");
  console.error(`[Sightline] Watched folder: ${watchFolder}`);
  console.error(
    `[Sightline] Backends: ${backendManager
      .describeBackends()
      .map(
        (backend) =>
          `${backend.name} (${backend.available ? "available" : `unavailable: ${backend.note}`})`
      )
      .join(", ")}`
  );
  console.error(
    `[Sightline] Max image size: ${formatBytes(maxBytes)} (override with ${MAX_IMAGE_BYTES_ENV})`
  );
  console.error(`[Sightline] Clipboard capture: ${clipboardStatus}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});


