# Sightline MCP

Universal Image Vision Bridge for Coding Agents.

Enables vision capabilities for non-vision-capable coding agents via the Model Context Protocol (MCP).

## What it does

When a coding agent runs on a model without vision support, it can't process images that users paste into conversations. Sightline acts as a vision proxy — the agent calls a tool, Sightline sends the image to a vision backend (Gemini API or local Ollama), and returns a text description (or structured JSON) the agent can read.

Seven tools are exposed: `view_image` (analyze one image), `list_images`, `view_latest`, `compare_images` (diff 2-8 images in one call), `crop_image` (extract a region and get it back as an image), `save_image` (store an inline image into the watched folder), and `cache_status` (diagnostics). With `SIGHTLINE_CLIPBOARD=1` it can also capture images straight off the clipboard, so copying a screenshot is enough to make it analyzable.

## Installation

Five ways to run it, fastest first. Every method runs the same code:

### 1. `npx` (recommended for most people)

No clone, no build. `npx` fetches the package from npm and runs it:

```bash
npx -y sightline-mcp
```

Then point your MCP client at it (OpenCode example — see
[Usage with MCP Clients](#usage-with-mcp-clients) for the others):

```jsonc
{
  "mcp": {
    "sightline": {
      "type": "local",
      "command": ["npx", "-y", "sightline-mcp"],
      "enabled": true,
      "environment": { "GEMINI_API_KEY": "{env:GEMINI_API_KEY}" }
    }
  }
}
```

### 2. Global npm install

```bash
npm install -g sightline-mcp
sightline-mcp              # on your PATH via the bin entry
```

### 3. Docker

The image is stdio-based and stateless; configuration comes from env vars,
and host folders are mounted where the server expects them:

```bash
docker run -i --rm \
  -e GEMINI_API_KEY=... \
  -e SIGHTLINE_WATCH_FOLDER=/data/images \
  -e SIGHTLINE_CACHE_FILE=/data/sightline/cache.json \
  -v ~/screenshots:/data/images \
  -v ~/.sightline:/data/sightline \
  ghcr.io/usher-pb/sightline-mcp
```

Clipboard capture is off automatically in Docker (no display to read from);
point `SIGHTLINE_WATCH_FOLDER` at a mounted host folder instead.

### 4. From source (contributors, offline machines)

```bash
git clone https://github.com/USHER-PB/sightline-mcp.git
cd sightline-mcp
npm install
npm run build
node dist/index.js
```

### 5. Registry (Smithery)

Smithery gives the server one-click discovery plus a config UI. Two routes,
per [their publish docs](https://smithery.ai/new):

- **Local (stdio) servers:** package an `.mcpb` bundle following Anthropic's
  [MCPB guide](https://claude.com/docs/connectors/building/mcpb) — the bundle
  carries the built `dist/`, a start command of `node dist/index.js`, and the
  same env knobs listed above — then publish it:
  ```bash
  smithery mcp publish ./server.mcpb -n <your-org>/sightline-mcp
  ```
- **Hosted servers:** register a public HTTPS URL serving Streamable HTTP.
  This binary speaks stdio only, so that route needs an HTTP wrapper first
  (out of scope here).

Either way, clipboard capture needs a display, so it stays off in hosted
runtimes and in any sandboxed install.

## Configuration

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
separated), with `~` expansion so `~/Desktop` resolves to your real home:

```bash
export SIGHTLINE_WATCH_FOLDER=/home/user/screenshots,/home/user/downloads
export SIGHTLINE_WATCH_FOLDER=~/screenshots,~/Downloads/captures
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

### Optional: Clipboard Capture

Copy a screenshot instead of saving it, and Sightline writes it into the watched
folder for you — so `list_images` and `"latest"` pick it up with no manual save
step:

```bash
export SIGHTLINE_CLIPBOARD=1                 # default: 0 (off)
export SIGHTLINE_CLIPBOARD_INTERVAL_MS=1000  # clipboard poll interval (default: 1000)
```

Off by default, because a clipboard routinely holds sensitive material
(passwords, tokens, private messages). When enabled, Sightline polls the
clipboard and saves newly-copied images as `clipboard-<timestamp>.<ext>` at the
top level of the watched folder. An image already on the clipboard at startup is
ignored rather than harvested, and an image that stays on the clipboard is saved
only once.

Requires a clipboard tool: `wl-paste` (Wayland, from the `wl-clipboard` package)
or `xclip` (X11, and Wayland through XWayland). The server prefers `wl-paste`
and falls back to `xclip`; if neither is installed, it logs that clipboard
capture is unavailable and keeps running normally. On Wayland, native Wayland
apps may not expose their clipboard to `xclip`, so install `wl-clipboard` for
reliable capture:

```bash
sudo apt install wl-clipboard
```

Only copy *after* the server is running — an image already on the clipboard at
startup is baselined and ignored (see above), never harvested.

### Optional: Image Size Limit

Sightline refuses to send oversized payloads to a backend:

```bash
export SIGHTLINE_MAX_IMAGE_BYTES=10485760   # default: 10 MiB
```

## Usage with MCP Clients

**First build the server** — every client below spawns `dist/index.js`, so it
must exist:

```bash
npm install && npm run build
```

Configuration lives in the *client's* config file, and the exact shape depends
on the client: OpenCode uses an `mcp` object with an array `command` and an
`environment` block, while Claude Desktop / Claude Code (and many others) use
`mcpServers` with a separate `command`/`args` pair and an `env` block. Use the
one that matches your client.

### OpenCode

Add to `~/.config/opencode/opencode.json` (global) or an `opencode.json` in
your project — the two are merged:

```jsonc
{
  "mcp": {
    "sightline": {
      "type": "local",
      "command": ["node", "/absolute/path/to/sightline-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "GEMINI_API_KEY": "{env:GEMINI_API_KEY}",
        "SIGHTLINE_BACKENDS": "gemini",
        "SIGHTLINE_WATCH_FOLDER": "~/.sightline/images",
        "SIGHTLINE_CLIPBOARD": "1"
      }
    }
  }
}
```

OpenCode substitutes `{env:NAME}` from your shell and `{file:path}` from a
file, so the API key does not have to sit in the config (see below).

Restart OpenCode, then confirm:

```bash
opencode mcp list
# ● ✓ sightline  connected
```

### Claude Desktop / Claude Code and other `mcpServers` clients

Same idea, different shape — for example in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sightline": {
      "command": "node",
      "args": ["/absolute/path/to/sightline-mcp/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here",
        "SIGHTLINE_WATCH_FOLDER": "/home/user/screenshots"
      }
    }
  }
}
```

For a local-only Ollama setup in either format, just change the env object —
no `GEMINI_API_KEY` needed:

```json
"SIGHTLINE_BACKENDS": "ollama",
"OLLAMA_VISION_MODEL": "moondream"
```

### Verifying it works

1. The server logs its startup state to **stderr** — look for:
   ```
   [Sightline] Backends: Gemini (available)
   [Sightline] Clipboard capture: on (wl-paste, every 1000ms)
   ```
2. Ask the agent to run `cache_status()` — it reports the cache plus every backend's live availability.
3. On OpenCode specifically, `opencode mcp list` must show `sightline` as `connected` — that alone proves the command path, the JSON, and the env block are all correct.

### Keep the API key out of version control

Never commit a `GEMINI_API_KEY`. Prefer an environment variable or a
`chmod 600` file referenced by substitution (`{env:GEMINI_API_KEY}` or
`{file:~/.sightline/gemini-key}` with no trailing newline), and rotate any key
that has ever been pasted into a chat, ticket, issue, or log.

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
  `<watched folder>/derived/`. Note the watcher only indexes the top level of
  the folder, so reference saved crops by their returned path (or pipe the
  returned data URI straight into `view_image`) rather than `latest`.

**Example:**

```
crop_image(image: "./screenshot.png", region: { x: 0, y: 0, width: 400, height: 120 }, save: true)
```

Cropping currently requires a PNG source; other formats are rejected with a
clear message.

### save_image

Saves an image (data URI or raw base64) into the top level of the watched
folder so it becomes discoverable through `list_images` and the `latest`
selector. No analysis is performed; the bytes are stored as-is.

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

## Recipes: What You Can Do Now

Concrete examples of what an agent (or you, driving the tools by hand) can do
with each feature. Tool calls are written in the same shorthand an MCP client
sends; everything here works against a running server with at least one
backend configured.

### 1. Understand any screenshot you paste

**You:** *"What's on this screenshot?"* (pastes a PNG as a data URI)

```
view_image(image: "data:image/png;base64,iVBORw0KGgo...")
→ **Image: inline image** (general mode, via Gemini)

A settings dialog titled "Privacy". A toggle labeled "Usage analytics" is
switched off. Below it is a warning in orange: "Changes take effect after
restart"...
```

The agent now knows what it "saw" and can answer questions about it — no
vision-capable model required.

### 2. The zero-friction screenshot loop

**Setup:** `export SIGHTLINE_WATCH_FOLDER=~/screenshots` — take screenshots
with your OS shortcut, then just ask:

**You:** *"Look at my latest screenshot."*

```
view_latest(mode: "error")
→ **Image: shot-2026-09-22-1015.png** (error mode, via Ollama)

Error: ECONNREFUSED 127.0.0.1:5432 — the Postgres connection was refused...
```

No paths, no file names, no pasting — saving the screenshot is the whole
workflow. Ask again and the answer comes back `(cached)` instantly.

### 3. Grab text out of an image (OCR)

**You:** *"Copy the text from this photo of the whiteboard."*

```
view_image(image: "./whiteboard.png", mode: "ocr")
→ Sprint Planning
  - Migrate auth service (Priya, 3 pts)
  - Fix flaky checkout test (Marco, 2 pts)
  ...
```

Verbatim transcription in reading order — paste it into notes, a ticket, or a
file the agent writes for you.

### 4. Debug from a crash screenshot

**You:** *"Why did this fail?"* (screenshots the terminal)

```
view_image(image: "latest", mode: "error")
→ TypeError: Cannot read properties of undefined (reading 'map')
    at renderList (App.tsx:42:18)
```

The `error` mode extracts the message, type, file, and line number — enough
for the agent to jump straight to `App.tsx:42` and propose a fix.

### 5. Have an architecture diagram explained

**You:** *"What does this diagram describe?"*

```
view_image(image: "./infra.png", mode: "diagram")
→ A Kubernetes ingress topology: traffic enters via NGINX (top), fans out to
  three services (auth, orders, billing)...
```

### 6. Review a UI change

**You:** *"How is this settings page structured?"*

```
view_image(image: "./settings.png", mode: "ui-layout")
→ Two-column layout: left nav (5 items, "Advanced" selected), right panel
  with 3 grouped sections...
```

### 7. Find a UI element, then zoom into it (two-step precision)

Tiny text or a small widget? Locate it first, then analyze just that region:

```
view_image(image: "./dashboard.png", mode: "ui-elements")
→ structuredContent: elements: [
    { label: "Export CSV", role: "button",
      box: { x: 0.87, y: 0.04, w: 0.09, h: 0.03 } }, ...
  ]

# Boxes are normalized 0-1; convert to pixels for a 1600x900 screenshot:
view_image(image: "./dashboard.png",
           region: { x: 1392, y: 36, width: 144, height: 27 }, mode: "ocr")
→ "Export CSV"
```

`ui-elements` finds it, `region` reads it — the crop-and-analyze happens
server-side in one call, no image editor needed.

### 8. Extract a crop as a reusable image

**You:** *"Cut out the top banner and keep it as its own image."*

```
crop_image(image: "./page.png", region: { x: 0, y: 0, width: 800, height: 120 },
           save: true)
→ **Image: page.png [region 800x120 at 0,0]** (crop 800x120 at 0,0 of 1600x900)
   Saved to .../derived/page-...png (2.1 KB)
   [returns the cropped image itself as an image block]
```

The text carries the crop's data URI (pipe it back into `view_image`), the
image block shows the result, and `save: true` files it under `derived/`
for later reference by path. (The watcher indexes only the top level of the
folder, so saved crops won't become `latest` — `save_image` does that.)
Source must be PNG.

### 9. Before/after comparison (visual regression)

**You:** *"I changed the signup form — what actually looks different?"*

```
compare_images(images: ["./before.png", "./after.png"])
→ **Image: before.png, after.png** (general mode, 2 images, via Gemini)

Identical: page header, footer, field order.
Changed: the "Sign up" button is now primary blue (was grey); a new
"Accept terms" checkbox appears above the button in Image 2 only...
```

Both images go to the model **in one call** with an `Image 1 = ...`
legend, so every statement names the screenshot it applies to. Ask the same
question again — it's a cache hit, zero API calls.

### 10. Ask a custom question instead of getting a description

**You:** *"Is the 'Delete account' button visible without scrolling?"*

```
view_image(image: "~/Desktop/profile.png",
           prompt: "Is a 'Delete account' button visible? Where exactly?")
→ "Yes — bottom-left of the visible area, in red text, below 'Sign out'..."
```

The custom prompt **replaces** the mode's preset, so you get exactly the
question answered.

### 11. Pull a value out of an image, as JSON an agent can use

**You:** *"Extract the build number, commit hash, and status from this
badge as structured data."*

```
view_image(image: "./badge.png", output: "json",
           prompt: "Extract build number, commit hash, and status as JSON.")
→ content:          { "build": "1842", "commit": "af41578", "status": "passing" }
   structuredContent: { build: "1842", commit: "af41578", status: "passing" }
```

`structuredContent` is machine-readable MCP output — the agent can branch on
`status === "passing"` without regex-scraping prose. Fenced/prose-wrapped
JSON from the model is tolerated; if all else fails you still get the text.

### 12. Stage a pasted image into the workflow

**You:** (pastes a diagram as a data URI) *"Save this so we can refer to it
later."*

```
save_image(image: "data:image/png;base64,...", filename: "proposed-arch")
→ **Image saved** to .../proposed-arch.png (48.3 KB, image/png).
   Discoverable via list_images and the 'latest' selector.
```

Now this file is addressable by name while `"latest"` keeps tracking your
screenshots — and the extension is fixed up from the actual bytes, so a JPEG
saved as `.png` still lands as `.jpg`.

### 13. Work with several images at once

```
list_images(limit: 5)
→ 1. error-1015.png (24.5 KB, modified: 2026-09-22T10:15:02Z)
   2. ui-before.png (88.1 KB, modified: 2026-09-22T09:02:44Z)
   ...

view_image(image: "latest:2", mode: "ocr")   # the one before the newest
```

`latest:N` reaches back through history without computing paths; combining
two selectors gives an ad-hoc pair for `compare_images`:

```
compare_images(images: ["latest:2", "latest"])   # previous vs current
```

### 14. Watch several folders at once

```
export SIGHTLINE_WATCH_FOLDER=~/screenshots,~/Downloads/captures
```

Screenshots land in one folder, CI artifact dumps in another — `list_images`,
`"latest"`, and `"save_image"` (primary folder) see them all as one stream.

### 15. Keep API spend under control

No configuration needed for the basics — identical questions return
`(cached)` from the LRU cache, **which now survives restarts** (flushed to
`~/.sightline/cache.json` on shutdown, restored on boot). To shape the spend
further:

```
export SIGHTLINE_CACHE_MAX_SIZE=500        # remember more
export SIGHTLINE_CACHE_TTL_MS=604800000    # for a week instead of a day
export SIGHTLINE_MAX_CONCURRENT=1          # never parallel-hit the API
export SIGHTLINE_MIN_INTERVAL_MS=500       # space calls at 2/sec max
```

The throttle queues an agent that fires ten tool calls at once — they execute
one by one instead of burning ten quota units in the same second.

### 16. Check the system's health mid-session

```
cache_status()
→ Cache
     entries: 42 / 100 (persisted: yes)
     hits: 17 | misses: 25 | evictions: 0 | expired: 3
     ttl: 86400000ms
   Backends
     Gemini: available
     Ollama: unavailable (Ollama not running at http://localhost:11434...)
   ...
```

Instant answer to *"why is this slow / why did it say 'all backends
failed'?"* — cache effectiveness and per-backend health in one call.

### 17. Run fully offline

```
export SIGHTLINE_BACKENDS=ollama        # no API key, no internet
export OLLAMA_VISION_MODEL=llava
```

Same seven tools, same modes, same cache — descriptions come from your own
machine. Add `gemini` back into `SIGHTLINE_BACKENDS` and a failure of either
one falls through to the other automatically.

### 18. Trust the errors enough to self-correct

An agent (or you) mistyping a mode, pointing at a deleted file, or requesting
a 9-image comparison gets a specific, actionable error — not a stack trace:

```
view_image(image: "latest", mode: "errror")
→ InvalidParams: Unknown mode "errror".
   Valid modes: general, ocr, ui-layout, ui-elements, error, diagram.
```

Every bad input (unknown mode, missing file, unsupported format like SVG,
oversized payload, duplicate/undersized comparison) arrives as
`InvalidParams` with a hint, so the next call can simply be correct.

### 19. Copy a screenshot instead of saving it

With `SIGHTLINE_CLIPBOARD=1`, the manual save step disappears. Copy a screenshot
anywhere (no Save As dialog), and the server picks it up:

```
[Clipboard] Captured clipboard-2026-09-23T09-46-18-271.png (1.2 KB, image/png)
```

Then just ask:

**You:** *"What's on the screenshot I just copied?"*

```
view_latest()
→ **Image: clipboard-2026-09-23T09-46-18-271.png** (general mode, via Gemini)

A terminal window showing the failing test run...
```

The capture is already the newest image in the folder, so `"latest"` refers to
it with no path juggling. Uses `wl-paste` on Wayland or `xclip` on X11 /
XWayland.

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

### Clipboard Capture

An optional clipboard-to-folder bridge: copy an image anywhere and it appears in
the watched folder as a normal screenshot, ready for `view_latest`. Off by
default (clipboards hold secrets), deduplicated so a static clipboard is not
re-saved on every poll, baselined at startup so pre-existing clipboard contents
are never harvested, and tolerant of reads failing while an application is busy.

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

## Production Readiness

**Verdict: production-ready for a personal/local coding-agent deployment**
(running the server under your own user account for your own agent), with
deliberate boundaries you should know about.

### What makes it ready

- **Type safety:** strict `tsc` passes on both the source and the test
  projects, with `noUnusedLocals`/`noUnusedParameters` on.
- **Tested:** 130 `node:test` tests (zero extra dependencies) covering every
  pure module, plus a 43-check stdio end-to-end run against a fake backend —
  and a 10-check end-to-end run against the real clipboard — that must all
  pass before every commit.
- **Handles abuse gracefully:** typed `SightlineError`s map to the correct
  JSON-RPC codes (bad input → `-32602`, failure → `-32603`, unknown tool →
  `-32601`); oversized payloads, missing files, and unsupported formats are
  rejected before any backend call; throttling caps backend concurrency; the
  filesystem watcher and clipboard reader log and recover instead of crashing.
- **Observable:** startup logs backend availability, watch folders, cache
  state, and clipboard status; `cache_status` exposes cache and backend
  health mid-session.
- **Robust inputs:** `~` expansion on every configured path, multi-folder
  watching, `latest:N` history access, and re-scanning on every call so a
  missed filesystem event can never produce a stale list.

### What it deliberately is not

- **Local trust model only.** The server reads any image file the OS user can
  read, and any local process that can spawn it can use it. Do not expose it
  on a network socket or run it as a shared multi-user service without adding
  authentication and path sandboxing — there is none.
- **Single-process state.** The in-memory cache (and thus hit counters) live
  per process; two instances pointed at the same cache file will overwrite
  each other (last writer wins).
- **One watched `~/.sightline/cache.json` lock-free file.** Crash-safe
  (atomic rename, validated on load, corrupt files ignored), but not a
  database — don't point concurrent writers at it.
- **Clipboard capture is best-effort.** Polling means ~1 s latency; native
  Wayland apps need `wl-clipboard` installed; the server cannot see images
  inside apps that never put bytes on the clipboard or the filesystem (such
  chat attachments stay where they are).

### Operational checklist

1. `npm run build` after every update, then restart the MCP client so it
   spawns the new `dist/index.js`.
2. Watch stderr once at startup: backends showing `available`, folders
   resolved to real absolute paths, clipboard status as expected.
3. Keep `GEMINI_API_KEY` in an env var or a `chmod 600` file with
   `{env:}`/`{file:}` substitution — never in version control.
4. Copy *after* the server starts for clipboard captures; quote the startup
   baseline rule to anyone confused by a stale `latest`.

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
probing, request throttling, JSON output parsing, the clipboard watcher, the
Ollama and Gemini clients (with mocked `fetch`), env parsing (including `~`
expansion), and the folder watcher — 130 tests in total.

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

**Phase 8 (complete):** Clipboard capture - optional clipboard-to-folder bridge
(`SIGHTLINE_CLIPBOARD`), with `wl-paste`/`xclip` detection, a startup baseline so
pre-existing clipboard contents are never harvested, dedupe so a static
clipboard is saved only once, and `~` expansion on every configured path
(130 tests).

## Future Improvements

### Additional Backends

The `VisionBackend` interface (`src/vision-backend.ts`) is the only contract a
provider must satisfy - `describe()` plus an optional `probe()`. Adding OpenAI,
Anthropic, or a remote Ollama host means implementing that interface and
registering a factory in `src/backend-manager.ts`.

## License

MIT
