# Sightline MCP

Universal Image Vision Bridge for Coding Agents.

Enables vision capabilities for non-vision-capable coding agents via the Model Context Protocol (MCP).

## What it does

When a coding agent runs on a model without vision support, it can't process images that users paste into conversations. Sightline acts as a vision proxy — the agent calls the `view_image` tool, Sightline sends the image to Gemini's API, and returns a text description the agent can read.

## Installation

```bash
npm install
npm run build
```

## Configuration

Set the `GEMINI_API_KEY` environment variable:

```bash
export GEMINI_API_KEY=your_api_key_here
```

Get a Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

## Usage with MCP Clients

Add to your MCP client configuration (e.g., Claude Code, OpenCode):

```json
{
  "mcpServers": {
    "sightline": {
      "command": "node",
      "args": ["/path/to/sightline-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available Tools

### view_image

Analyzes an image and returns a text description.

**Parameters:**

- `image` (required): The image to analyze. Accepts:
  - Base64 data URI: `data:image/png;base64,...`
  - File path: `/absolute/path/to/image.png` or `./relative/path.png`
  - Raw base64 string
- `prompt` (optional): Guidance for what to focus on. Default: general description prompt.

**Example tool calls:**

```
view_image(image: "data:image/png;base64,iVBORw0KGgo...")
view_image(image: "/home/user/screenshots/error.png")
view_image(image: "./diagram.png", prompt: "Explain the architecture shown in this diagram")
```

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm start        # Run the server
```

## Roadmap

**Phase 1 (current):** MCP server with Gemini backend, base64 and file path support.

**Future phases:**
- Hash-based caching to reduce API calls
- Prompt mode presets (OCR, UI layout, error-focused)
- Pluggable backend abstraction
- Local model fallback (Moondream/Ollama)

## License

MIT