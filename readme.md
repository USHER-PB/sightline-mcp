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

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Optional: Watched Folder

Set `SIGHTLINE_WATCH_FOLDER` to specify a folder for automatic screenshot detection:

```bash
export SIGHTLINE_WATCH_FOLDER=/home/user/screenshots
```

Default: `~/.sightline/images`

When configured, any images saved to this folder are automatically detected and can be analyzed using `view_latest` or `list_images`.

### Optional: Cache Configuration

Control the in-memory cache behavior:

```bash
export SIGHTLINE_CACHE_MAX_SIZE=100      # Max cached images (default: 100)
export SIGHTLINE_CACHE_TTL_MS=86400000   # Cache TTL in ms (default: 24 hours)
```

The cache reduces API calls by storing results keyed by image hash and prompt.

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
  - `"latest"` — use the most recent image in the watched folder
  - Raw base64 string
- `prompt` (optional): Guidance for what to focus on. Default: general description prompt.

**Example tool calls:**

```
view_image(image: "data:image/png;base64,iVBORw0KGgo...")
view_image(image: "/home/user/screenshots/error.png")
view_image(image: "latest")
view_image(image: "./diagram.png", prompt: "Explain the architecture shown in this diagram")
```

### list_images

Lists all images currently in the watched folder, sorted by most recent first.

**Parameters:**

- `limit` (optional): Maximum number of images to list. Default: 10.

**Example:**

```
list_images()
list_images(limit: 20)
```

Returns image names, sizes, and modification timestamps.

### view_latest

Analyzes the most recent image in the watched folder. Convenience tool combining `list_images` and `view_image`.

**Parameters:**

- `prompt` (optional): Guidance for what to focus on. Default: general description prompt.

**Example:**

```
view_latest()
view_latest(prompt: "What error is shown in this screenshot?")
```

## Features

### Hash-based Caching

Results are cached in-memory using SHA-256 hashes of the image content and prompt. This reduces API calls when the same image is analyzed multiple times in a session. Cache hits return instantly with a `(cached)` indicator.

### Watched Folder Integration

Save screenshots to a folder and analyze them without providing paths. The server watches for new images and makes them available via `list_images` and `view_latest`.

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm start        # Run the server
```

## Roadmap

**Phase 1 (complete):** MCP server with Gemini backend, base64 and file path support.

**Phase 2 (complete):** Watched folder for automatic screenshot detection, list_images and view_latest tools.

**Phase 3 (complete):** Hash-based caching to reduce API calls.

**Future phases:**
- Prompt mode presets (OCR, UI layout, error-focused)
- Pluggable backend abstraction
- Local model fallback (Moondream/Ollama)

## License

MIT

## Future Improvements

### Persistent Cache Storage

Currently, the cache is in-memory only and resets on server restart. Future versions should implement persistent storage:

**Option 1: File-based**
```bash
# Cache persisted to disk
~/.sightline/cache.json
```

**Option 2: SQLite**
```bash
# Local database for cache
~/.sightline/cache.db
```

This would allow cache to survive MCP server restarts and reduce API calls across sessions.

**Implementation notes:**
- Use the existing `ImageCache` interface
- Add `load()` and `save()` methods
- Load cache on server startup
- Save cache periodically and on shutdown
- Handle cache corruption gracefully
