# Sightline MCP

Universal Image Vision Bridge for Coding Agents.

Enables vision capabilities for non-vision-capable coding agents via the Model Context Protocol (MCP).

## What it does

When a coding agent runs on a model without vision support, it can't process images that users paste into conversations. Sightline acts as a vision proxy — the agent calls a tool, Sightline sends the image to a vision backend (Gemini API or local Ollama), and returns a text description (or structured JSON) the agent can read.

Seven tools are exposed: `view_image` (analyze one image), `list_images`, `view_latest`, `compare_images` (diff 2-8 images in one call), `crop_image` (extract a region and get it back as an image), `save_image` (store an inline image into the watched folder), and `cache_status` (diagnostics).

## Installation

```bash
npm install
npm run build
```

## Configuration

### Required: Vision Backend

Sightline supports multiple vision backends with automatic fallback.

**Option 1: Gemini API (Cloud)**

```bash
export GEMINI_API_KEY=your_api_key_here
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

**Option 2: Ollama (Local, Offline)**

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a vision model
ollama pull moondream

# Optional: Configure Ollama
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_VISION_MODEL=moondream
```

Supported Ollama models: `moondream`, `llava`, `bakllava`, `cogvlm`

**Option 3: Both (with Fallback)**

```bash
export GEMINI_API_KEY=your_api_key_here
# Ollama will be used as fallback if Gemini fails
```

Configure backend order:

```bash
# Gemini primary, Ollama fallback (default)
export SIGHTLINE_BACKENDS=gemini,ollama

# Ollama primary, Gemini fallback
export SIGHTLINE_BACKENDS=ollama,gemini

# Ollama only (offline mode)
export SIGHTLINE_BACKENDS=ollama
```

Unknown values are ignored (with a warning on stderr) rather than silently
disabling vision. Backends are probed at startup, and the startup log reports
which ones are reachable:

```
[Sightline] Backends: Gemini (available), Ollama (unavailable: probe failed)
```

Optional model overrides:

```bash
export GEMINI_VISION_MODEL=gemini-2.5-flash   # default
export OLLAMA_VISION_MODEL=moondream          # default
```

### Optional: Watched Folder

Set `SIGHTLINE_WATCH_FOLDER` to specify a folder for automatic screenshot detection:

```bash
export SIGHTLINE_WATCH_FOLDER=/home/user/screenshots
```

Multiple folders can be watched at once (comma- and/or platform-delimiter
separated):

```bash
export SIGHTLINE_WATCH_FOLDER=/home/user/screenshots,/home/user/downloads
```

Default: `~/.sightline/images`. Relative values are resolved against the
server's working directory.

### Optional: Cache Configuration

Control the cache behavior:

```bash
export SIGHTLINE_CACHE_MAX_SIZE=100      # Max cached images (default: 100)
export SIGHTLINE_CACHE_TTL_MS=86400000   # Cache TTL in ms (default: 24 hours)
export SIGHTLINE_CACHE_PERSIST=1         # Persist cache to disk (default: 1)
export SIGHTLINE_CACHE_FILE=~/.sightline/cache.json  # Cache file location
```

The cache is least-recently-used: when it is full, the least recently used
result is evicted, and expired entries are purged by a background janitor.
Invalid values fall back to the defaults.

With persistence enabled (the default), results survive restarts: the cache is
loaded at startup and flushed to disk on graceful shutdown (plus a debounced
write after each change). Only hashes, prompts, and the model's text output are
stored — never image bytes. Set `SIGHTLINE_CACHE_PERSIST=0` for a purely
in-memory cache.

### Optional: Request Throttling

Serializes backend calls so a fast agent cannot hammer a shared API quota or
thrash a local model:

```bash
export SIGHTLINE_MAX_CONCURRENT=1    # Backend calls in flight at once (default: 1)
export SIGHTLINE_MIN_INTERVAL_MS=0   # Minimum spacing between call starts (default: 0)
```

### Optional: Image Size Limit

Sightline refuses to send oversized payloads to a backend:

```bash
export SIGHTLINE_MAX_IMAGE_BYTES=10485760   # default: 10 MiB
```

## Usage with MCP Clients

Add to your MCP client configuration (e.g., Claude Code, OpenCode, Kiro):

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

For offline/local-only:

```json
{
  "mcpServers": {
    "sightline": {
      "command": "node",
      "args": ["/path/to/sightline-mcp/dist/index.js"],
      "env": {
        "SIGHTLINE_BACKENDS": "ollama",
        "OLLAMA_VISION_MODEL": "moondream"
      }
    }
  }
}
```

## Available Tools

### view_image

Analyzes an image and returns a text description (or structured JSON).

**Parameters:**

- `image` (required): The image to analyze. Accepts:
  - `"latest"` — use the most recent image in the watched folder
  - `"latest:N"` — the N-th most recent image (1 = newest, 2 = the one before it, ...)
  - Base64 data URI: `data:image/png;base64,...`
  - File path: absolute (`/abs/path.png`), relative (`./shot.png` or `screenshots/shot.png`), or `~/shot.png`
  - Raw base64 string
- `mode` (optional): Analysis mode preset. Default: `general`.
  - `general`: Balanced description of image content
  - `ocr`: Extract all visible text verbatim
  - `ui-layout`: Focus on UI structure, elements, and hierarchy
  - `ui-elements`: Locate interactive elements with normalized bounding boxes (returns JSON)
  - `error`: Identify errors, warnings, and diagnostic information
  - `diagram`: Explain diagrams, flowcharts, and architecture
- `prompt` (optional): Custom prompt. When provided it **replaces** the mode's preset prompt.
- `output` (optional): `text` (default) or `json`. With `json`, the model's
  answer is parsed and returned as MCP `structuredContent` alongside the text.
  The `ui-elements` mode defaults to `json`.
- `region` (optional): Crop rectangle (`x`, `y`, `width`, `height` in pixels
  from the top-left) to analyze instead of the whole image — use it to zoom
  into small text. Requires a PNG image; get coordinates from `ui-elements`.

Supported formats: PNG, JPEG, GIF, WEBP (detected from the payload's magic bytes,
not from the file name). SVG and HEIC are not supported. Images larger than
`SIGHTLINE_MAX_IMAGE_BYTES` are rejected before any backend call.

**Example tool calls:**

```
view_image(image: "/home/user/screenshots/error.png")
view_image(image: "latest", mode: "error")
view_image(image: "latest:2", mode: "ocr")
view_image(image: "./diagram.png", mode: "diagram")
view_image(image: "~/Desktop/screenshot.png", prompt: "What button should I click?")
view_image(image: "./tiny-text.png", region: { x: 100, y: 40, width: 320, height: 200 })
view_image(image: "./ui.png", mode: "ui-elements", output: "json")
```

Invalid input (unknown mode, missing file, unsupported format, oversized image)
is reported as an MCP `InvalidParams` error with a hint describing the accepted
forms, so the calling agent can correct itself.

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

- `mode` (optional): Analysis mode preset. Default: `general`.
- `prompt` (optional): Custom prompt to override the mode's default.

**Example:**

```
view_latest()
view_latest(mode: "error")
view_latest(mode: "ocr")
```

### compare_images

Compares two or more images in a single backend call and reports what is
identical, what differs, and which image each statement applies to — useful for
before/after screenshots and visual regression checks.

**Parameters:**

- `images` (required): Array of 2 to 8 image references; each entry accepts
  the same forms as `view_image`'s `image` parameter (`"latest"`, data URI,
  path, raw base64).
- `mode` (optional): Analysis mode preset. Default: `general`.
- `prompt` (optional): Custom comparison prompt (replaces the default).
- `output` (optional): `text` (default) or `json`.

All images are sent to the model together, each labelled (`Image 1 = ...`) so
its statements can be tied back to the right file. Duplicate images are
rejected — comparing an image with itself is always a mistake.

**Example:**

```
compare_images(images: ["./before.png", "./after.png"])
compare_images(images: ["latest:2", "latest"], prompt: "Which registration fields changed?")
```

### crop_image

Crops a rectangular region out of a PNG image and returns the crop as an image
content block (plus a data URI in the text) that can be piped into
`view_image`. Alternatively, use `view_image`'s `region` parameter to crop and
analyze in one step.

**Parameters:**

- `image` (required): The source image (any accepted form).
- `region` (required): `x`, `y`, `width`, `height` in pixels from the top-left.
- `save` (optional): When `true`, also writes the crop to
  `<watched folder>/derived/` so it becomes a normal watched image.

**Example:**

```
crop_image(image: "./screenshot.png", region: { x: 0, y: 0, width: 400, height: 120 }, save: true)
```

Cropping currently requires a PNG source; other formats are rejected with a
clear message.

### save_image

Saves an image (data URI or raw base64) into the watched folder so it becomes
discoverable through `list_images` and the `latest` selector. No analysis is
performed; the bytes are stored as-is.

**Parameters:**

- `image` (required): The image to save (any accepted form).
- `filename` (optional): File name inside the watched folder (e.g.
  `pasted-diagram.png`). The extension is normalized to the image's actual
  format. Defaults to `sightline-<timestamp>.<ext>`.

**Example:**

```
save_image(image: "data:image/png;base64,...", filename: "pasted-diagram")
```

### cache_status

Returns live cache and backend diagnostics: entry count, hits/misses, TTL,
persistence state, and which vision backends are currently available.

**Example:**

```
cache_status()
```

## Prompt Modes

Sightline provides preset analysis modes optimized for different use cases:

| Mode | Description | Best For |
|------|-------------|----------|
| `general` | Balanced description of image content | General screenshots, photos |
| `ocr` | Extract all visible text verbatim | Text extraction, copying text from images |
| `ui-layout` | Focus on UI structure and elements | UI reviews, accessibility audits |
| `ui-elements` | Locate interactive elements with bounding boxes (JSON) | Feeding coordinates to `region`, UI automation |
| `error` | Identify errors and warnings | Error messages, stack traces, logs |
| `diagram` | Explain diagrams and architecture | Architecture diagrams, flowcharts |

Presets live in `src/prompt-modes.ts`; the tool schema's mode list and
descriptions are generated from that registry, so adding a mode updates the
tool definition automatically. An unknown mode is rejected with the list of
valid modes.

## Vision Backends

### Gemini (Cloud)

- **Pros**: High quality, fast, good free tier
- **Cons**: Requires API key, internet connection
- **Models**: `gemini-2.5-flash` (default, override with `GEMINI_VISION_MODEL`)
- **Free tier**: 15 RPM, 1M tokens/day
- **Inline image types**: PNG, JPEG, WEBP (GIF is not supported by the Gemini API)

### Ollama (Local)

- **Pros**: Offline, no API key, unlimited usage
- **Cons**: Requires local setup, slower on CPU
- **Models**: `moondream` (recommended), `llava`, `bakllava` (override with `OLLAMA_VISION_MODEL`)
- **Setup**: `ollama pull moondream`

### Automatic Fallback

When both backends are configured, Sightline automatically falls back:

1. Primary backend fails (quota exceeded, network error)
2. Automatically switches to next available backend
3. Logs the fallback to console
4. Returns which backend was used in response

If every backend fails, the tool error lists the failure from each one (for
example `Gemini: quota exceeded` and `Ollama: Ollama not running at ...`), so
the cause is visible without reading server logs.

## Features

### Pluggable Vision Backends

Support for multiple vision providers with automatic fallback. Start with Gemini's free tier, fall back to local Ollama when needed.

### Hash-based Caching

Results are cached in-memory using SHA-256 hashes over the image bytes and the
prompt. Same image + same prompt = instant cache hit, no API call. Eviction is
least-recently-used, and expired entries are purged by a background janitor.
By default the cache is also persisted to `~/.sightline/cache.json`
(`SIGHTLINE_CACHE_PERSIST=0` to disable), so results survive restarts.
`(mode, via <backend>)` / `(mode, cached)` in the tool output tells the agent
where a description came from. `cache_status` exposes the live numbers.

### Region Zoom and Cropping

`view_image`'s `region` parameter analyzes a crop instead of the whole image
(ideal for small text), and `crop_image` returns the crop itself as an image
the agent can re-inspect. Both use a built-in PNG codec
(`src/png.ts`) — no image-processing dependencies.

### Multi-image Comparison

`compare_images` sends 2-8 images to the model in one call with an explicit
legend (`Image 1 = before.png`, ...), so the model can relate them to each
other instead of describing them independently.

### Structured JSON Output

Every analysis tool accepts `output: "json"`. The prompt gets a JSON
instruction appended, and the (leniently parsed) model answer is returned as
MCP `structuredContent` alongside the text — bare JSON, fenced JSON, and JSON
buried in prose are all accepted, and unparseable output falls back to plain
text rather than losing the answer.

### Request Throttling

Backend calls are serialized through a throttle
(`SIGHTLINE_MAX_CONCURRENT`, `SIGHTLINE_MIN_INTERVAL_MS`) so a burst of tool
calls cannot exhaust an API quota or overload a local model.

### Watched Folder Integration

Save screenshots to a folder and analyze them without providing paths. The
server watches the folder and also re-scans it on every `list_images` call, so
a missed filesystem event can never leave a stale list behind. A watch failure
is logged and degrades gracefully instead of crashing the server.

### Prompt Mode Presets

Optimized analysis modes for common use cases: OCR, UI layout, error detection, and diagrams.

### Input Validation

Image payloads are validated before they reach a backend: the format is
detected from magic bytes, the payload is size-checked, and unsupported input
produces a clear `InvalidParams` error instead of a confusing backend failure.

## Development

```bash
npm run build      # Compile TypeScript to dist/
npm run typecheck  # Type-check without emitting
npm test           # Compile and run the Node test-runner suite
npm run dev        # Watch mode
npm start          # Run the server
```

### Tests

The suite uses the built-in `node:test` runner (no extra dependencies). Tests
live in `test/`, are compiled to `dist-test/`, and cover the pure modules:
image resolution and validation (including `latest:N`, multi-image requests,
and region parsing), the LRU cache and its persistent file store, the PNG
codec and cropping, prompt modes and comparison prompts, backend fallback and
probing, request throttling, JSON output parsing, the Ollama and Gemini
clients (with mocked `fetch`), env parsing, and the folder watcher — 115
tests in total.

```bash
npm test
```

`src/index.ts` is a thin MCP wiring layer (tool schemas, request routing, error
mapping) and is deliberately not imported by tests, since importing it starts
the server.

## Roadmap

**Phase 1 (complete):** MCP server with Gemini backend, base64 and file path support.

**Phase 2 (complete):** Watched folder for automatic screenshot detection, list_images and view_latest tools.

**Phase 3 (complete):** Hash-based caching to reduce API calls.

**Phase 4 (complete):** Prompt mode presets (OCR, UI layout, error-focused, diagram).

**Phase 5 (complete):** Pluggable backend abstraction with local model fallback.

**Phase 6 (complete):** Hardening pass - path/MIME validation with magic-byte
sniffing, payload size limits, LRU cache with a TTL janitor, graceful watcher
error handling, typed error-to-JSON-RPC mapping, startup backend probing, and a
`node:test` suite (71 tests).

**Phase 7 (complete):** Capability expansion - multi-image `compare_images`,
PNG `crop_image` with region zoom in `view_image`, `save_image`,
`cache_status`, `latest:N` selectors, structured JSON output
(`output: "json"` + MCP `structuredContent`), the `ui-elements` mode,
persistent cache across restarts, request throttling, multi-folder watching,
and tests for the new modules (115 tests).

## Future Improvements

### Clipboard Monitoring

Auto-detect images copied to clipboard without manual save steps.

### Additional Backends

The `VisionBackend` interface (`src/vision-backend.ts`) is the only contract a
provider must satisfy - `describe()` plus an optional `probe()`. Adding OpenAI,
Anthropic, or a remote Ollama host means implementing that interface and
registering a factory in `src/backend-manager.ts`.

## License

MIT
