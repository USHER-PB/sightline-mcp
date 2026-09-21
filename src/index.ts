#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { GeminiVisionBackend } from "./gemini-backend.js";
import { ImageWatcher } from "./image-watcher.js";
import { imageCache } from "./cache.js";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

// Watched folder configuration
const WATCH_FOLDER = process.env.SIGHTLINE_WATCH_FOLDER || resolve(process.env.HOME || "", ".sightline/images");

// Ensure watch folder exists
if (!existsSync(WATCH_FOLDER)) {
  mkdirSync(WATCH_FOLDER, { recursive: true });
  console.error(`[Sightline] Created watch folder: ${WATCH_FOLDER}`);
}

// Initialize vision backend
const visionBackend = new GeminiVisionBackend(GEMINI_API_KEY);

// Initialize image watcher
const imageWatcher = new ImageWatcher(WATCH_FOLDER);

// Create MCP server
const server = new Server(
  {
    name: "sightline-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "view_image",
        description:
          "Analyze an image and return a text description. Use this tool when you need to 'see' an image - screenshots, diagrams, UI mockups, error messages, or any visual content. Returns detailed description including any visible text, UI elements, diagrams, or relevant visual information.",
        inputSchema: {
          type: "object",
          properties: {
            image: {
              type: "string",
              description:
                "The image to analyze. Can be either a base64-encoded string, a file path, or 'latest' to use the most recent image in the watched folder. For base64, include the full data URI (e.g., 'data:image/png;base64,...'). For file paths, provide an absolute path to the image file.",
            },
            prompt: {
              type: "string",
              description:
                "Optional guidance for what to focus on in the image. Examples: 'Extract all visible text', 'Describe the UI layout', 'What error is shown?', 'Summarize this diagram'",
              default: "Describe what you see in this image, including any visible text, UI elements, or relevant details.",
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
            prompt: {
              type: "string",
              description:
                "Optional guidance for what to focus on in the image. Examples: 'Extract all visible text', 'Describe the UI layout', 'What error is shown?'",
              default: "Describe what you see in this image, including any visible text, UI elements, or relevant details.",
            },
          },
        },
      },
    ],
  };
});

// Handler for tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  // Handle list_images tool
  if (toolName === "list_images") {
    const args = (request.params.arguments || {}) as { limit?: number };
    const limit = args.limit || 10;
    const images = imageWatcher.listImages().slice(0, limit);

    if (images.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No images found in watched folder: ${WATCH_FOLDER}\n\nTip: Save screenshots to this folder, or set SIGHTLINE_WATCH_FOLDER to a different path.`,
          },
        ],
      };
    }

    const imageList = images
      .map(
        (img, i) =>
          `${i + 1}. ${img.name} (${(img.size / 1024).toFixed(1)} KB, modified: ${img.modifiedAt.toISOString()})`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${images.length} image(s) in ${WATCH_FOLDER}:\n\n${imageList}\n\nUse view_image with the full path, or view_latest to analyze the most recent one.`,
        },
      ],
    };
  }

  // Handle view_latest tool
  if (toolName === "view_latest") {
    const args = (request.params.arguments || {}) as { prompt?: string };
    const latestImage = imageWatcher.getLatestImage();

    if (!latestImage) {
      return {
        content: [
          {
            type: "text",
            text: `No images found in watched folder: ${WATCH_FOLDER}\n\nTip: Save screenshots to this folder, or use list_images to see available images.`,
          },
        ],
      };
    }

    const imageData = await imageWatcher.readImageAsBase64(latestImage.path);
    if (!imageData) {
      throw new McpError(ErrorCode.InternalError, `Failed to read image: ${latestImage.path}`);
    }

    const prompt = args.prompt || "Describe what you see in this image, including any visible text, UI elements, or relevant details.";

    // Check cache first
    const cached = imageCache.get(imageData.data, prompt);
    if (cached) {
      return {
        content: [
          {
            type: "text",
            text: `**Image: ${latestImage.name}** (cached)\n\n${cached.description}`,
          },
        ],
      };
    }

    // Call vision backend
    const description = await visionBackend.describe(
      imageData.data,
      prompt,
      imageData.mimeType
    );

    // Store in cache
    imageCache.set(imageData.data, prompt, description, imageData.mimeType);

    return {
      content: [
        {
          type: "text",
          text: `**Image: ${latestImage.name}**\n\n${description}`,
        },
      ],
    };
  }

  // Handle view_image tool
  if (toolName === "view_image") {
    const args = request.params.arguments as { image: string; prompt?: string };
    
    if (!args.image) {
      throw new McpError(ErrorCode.InvalidParams, "image parameter is required");
    }

    try {
      // Determine if input is base64, file path, or 'latest'
      let imageData: string;
      let mimeType: string | undefined;

      if (args.image === "latest") {
        // Use the latest image from watched folder
        const latestImage = imageWatcher.getLatestImage();
        if (!latestImage) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `No images found in watched folder: ${WATCH_FOLDER}`
          );
        }
        const imgData = await imageWatcher.readImageAsBase64(latestImage.path);
        if (!imgData) {
          throw new McpError(ErrorCode.InternalError, `Failed to read image: ${latestImage.path}`);
        }
        imageData = imgData.data;
        mimeType = imgData.mimeType;
      } else if (args.image.startsWith("data:image")) {
        // Base64 data URI
        const matches = args.image.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!matches) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid base64 data URI format. Expected: data:image/type;base64,..."
          );
        }
        mimeType = matches[1];
        imageData = matches[2];
      } else if (args.image.startsWith("/") || args.image.startsWith("./")) {
        // File path - read and convert to base64
        const fs = await import("fs/promises");
        const path = await import("path");
        
        const absolutePath = path.resolve(args.image);
        const fileBuffer = await fs.readFile(absolutePath);
        imageData = fileBuffer.toString("base64");
        
        // Determine mime type from extension
        const ext = path.extname(absolutePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
        };
        mimeType = mimeTypes[ext] || "image/png";
      } else {
        // Assume raw base64
        imageData = args.image;
        mimeType = undefined;
      }

      const prompt = args.prompt || "Describe what you see in this image, including any visible text, UI elements, or relevant details.";

      // Check cache first
      const cached = imageCache.get(imageData, prompt);
      if (cached) {
        return {
          content: [
            {
              type: "text",
              text: `${cached.description} (cached)`,
            },
          ],
        };
      }

      // Call vision backend
      const description = await visionBackend.describe(
        imageData,
        prompt,
        mimeType
      );

      // Store in cache
      imageCache.set(imageData, prompt, description, mimeType || "image/png");

      return {
        content: [
          {
            type: "text",
            text: description,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to analyze image: ${errorMessage}`);
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
});

// Start the server
async function main() {
  // Start the image watcher
  await imageWatcher.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sightline MCP server running on stdio");
  console.error(`[Sightline] Watched folder: ${WATCH_FOLDER}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
