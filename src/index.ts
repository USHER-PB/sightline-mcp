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

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

// Initialize vision backend
const visionBackend = new GeminiVisionBackend(GEMINI_API_KEY);

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
                "The image to analyze. Can be either a base64-encoded string or a file path. For base64, include the full data URI (e.g., 'data:image/png;base64,...'). For file paths, provide an absolute path to the image file.",
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
    ],
  };
});

// Handler for tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "view_image") {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as { image: string; prompt?: string };
  
  if (!args.image) {
    throw new McpError(ErrorCode.InvalidParams, "image parameter is required");
  }

  try {
    // Determine if input is base64 or file path
    let imageData: string;
    let mimeType: string | undefined;

    if (args.image.startsWith("data:image")) {
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

    // Call vision backend
    const description = await visionBackend.describe(
      imageData,
      args.prompt || "Describe what you see in this image, including any visible text, UI elements, or relevant details.",
      mimeType
    );

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
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sightline MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
