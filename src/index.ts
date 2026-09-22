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
import { ImageWatcher } from "./image-watcher.js";
import { createImageCacheFromEnv } from "./cache.js";
import {
  describeModes,
  getPromptForMode,
  parsePromptMode,
  PROMPT_MODE_NAMES,
} from "./prompt-modes.js";
import { BackendManager, createBackendManager } from "./backend-manager.js";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES_ENV,
  resolveImageInput,
  ResolvedImage,
} from "./image-input.js";
import { errorMessage, isSightlineError } from "./errors.js";
import { ensureDirectory, readPositiveIntEnv, resolveWatchFolder } from "./env.js";
import { formatBytes } from "./image-formats.js";

const SERVER_NAME = "sightline-mcp";

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
  mode?: unknown;
  prompt?: unknown;
  limit?: unknown;
}

type ToolResult = CallToolResult;

const MODE_ENUM = [...PROMPT_MODE_NAMES];
const MODE_DESCRIPTION = `Analysis mode preset. ${describeModes()} Default: 'general'.`;
const PROMPT_DESCRIPTION =
  "Optional custom prompt. When provided it replaces the mode's preset prompt entirely. Use this for specific questions like 'What error is shown?'.";

const IMAGE_DESCRIPTION =
  "The image to analyze. Accepts 'latest', an image data URI (data:image/png;base64,...), a file path (absolute, relative, or ~/...), or a raw base64 image.";

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
        },
      },
    },
  ];
}

function parseLimit(value: unknown, fallback = 10): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

async function main(): Promise<void> {
  const watchFolder = resolveWatchFolder();
  if (ensureDirectory(watchFolder)) {
    console.error(`[Sightline] Created watch folder: ${watchFolder}`);
  }

  const maxBytes = readPositiveIntEnv(MAX_IMAGE_BYTES_ENV, DEFAULT_MAX_IMAGE_BYTES);
  const imageCache = createImageCacheFromEnv();
  const stopCacheJanitor = imageCache.startJanitor();

  const imageWatcher = new ImageWatcher(watchFolder);
  await imageWatcher.start();

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
  async function analyze(image: ResolvedImage, mode: string, prompt: string): Promise<ToolResult> {
    const cached = imageCache.get(image.data, prompt);
    if (cached) {
      return text(`**Image: ${image.label}** (${mode} mode, cached)\n\n${cached.description}`);
    }

    const result = await backendManager.describe(image.data, prompt, image.mimeType);
    imageCache.set(image.data, prompt, result.description, image.mimeType);

    return text(
      `**Image: ${image.label}** (${mode} mode, via ${result.backend})\n\n${result.description}`
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
    const prompt = getPromptForMode(
      mode,
      typeof args.prompt === "string" ? args.prompt : undefined
    );
    const image = await resolveImageInput(input, {
      latestImageProvider: imageWatcher,
      maxBytes,
    });

    return analyze(image, mode, prompt);
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
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});


