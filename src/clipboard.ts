/**
 * Clipboard image monitoring.
 *
 * Copies images that land on the system clipboard into the watched folder, so
 * "copy a screenshot, then ask the agent about it" works without a manual save
 * step. Polling is used because neither X11 nor Wayland exposes a portable
 * clipboard-change event.
 *
 * Off by default: a clipboard routinely holds sensitive material (passwords,
 * tokens, private messages), so writing it to disk is opt-in via
 * `SIGHTLINE_CLIPBOARD=1`.
 */
import { execFile } from "child_process";
import { createHash } from "crypto";
import { writeFile as writeFileDefault } from "fs/promises";
import { join } from "path";
import { errorMessage } from "./errors.js";

export const CLIPBOARD_ENV = "SIGHTLINE_CLIPBOARD";
export const CLIPBOARD_INTERVAL_ENV = "SIGHTLINE_CLIPBOARD_INTERVAL_MS";
export const DEFAULT_CLIPBOARD_INTERVAL_MS = 1000;

/** How long a single clipboard read may take before it is abandoned. */
const PROBE_TIMEOUT_MS = 2000;
const READ_TIMEOUT_MS = 5000;

interface ImageTarget {
  target: string;
  extension: string;
  mimeType: string;
}

/** Image clipboard formats we can read, best first. */
const IMAGE_TARGETS: readonly ImageTarget[] = [
  { target: "image/png", extension: ".png", mimeType: "image/png" },
  { target: "image/jpeg", extension: ".jpg", mimeType: "image/jpeg" },
  { target: "image/webp", extension: ".webp", mimeType: "image/webp" },
  { target: "image/gif", extension: ".gif", mimeType: "image/gif" },
];

/** Runs a command and returns stdout as bytes. Injectable for tests. */
export type ExecBuffer = (command: string, args: string[], timeoutMs: number) => Promise<Buffer>;

export interface ClipboardTool {
  name: string;
  /** Arguments that exit successfully when the tool is installed. */
  probe: string[];
  /** Arguments that list the clipboard's advertised targets. */
  targetsArgs: string[];
  /** Arguments that write one target to stdout. */
  readArgs: (target: string) => string[];
}

/**
 * Supported clipboard tools, most reliable first. `wl-paste` is the native
 * Wayland client; `xclip` covers X11 and Wayland-through-XWayland.
 */
export const CLIPBOARD_TOOLS: readonly ClipboardTool[] = [
  {
    name: "wl-paste",
    probe: ["--version"],
    targetsArgs: ["--list-types"],
    readArgs: (target) => ["--type", target],
  },
  {
    name: "xclip",
    probe: ["-version"],
    targetsArgs: ["-selection", "clipboard", "-o", "-t", "TARGETS"],
    readArgs: (target) => ["-selection", "clipboard", "-o", "-t", target],
  },
];

/** Default exec implementation: capture stdout as a Buffer. */
export function execBuffer(command: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout)));
      }
    );
  });
}

/**
 * Find the first clipboard tool that is actually installed.
 * @returns the tool, or null when clipboard capture is unavailable.
 */
export async function detectClipboardTool(
  exec: ExecBuffer,
  tools: readonly ClipboardTool[] = CLIPBOARD_TOOLS
): Promise<ClipboardTool | null> {
  for (const tool of tools) {
    try {
      await exec(tool.name, tool.probe, PROBE_TIMEOUT_MS);
      return tool;
    } catch {
      // Not installed or not usable here; try the next candidate.
    }
  }

  return null;
}

/** Pick the best image target advertised by the clipboard. */
export function pickImageTarget(targets: string[]): ImageTarget | null {
  const advertised = new Set(targets.map((entry) => entry.trim().toLowerCase()));
  for (const candidate of IMAGE_TARGETS) {
    if (advertised.has(candidate.target)) return candidate;
  }
  return null;
}

/** Filesystem-safe timestamp, e.g. `2026-09-23T10-40-12-345`. */
export function captureStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

/** A clipboard image that was written into the watched folder. */
export interface CapturedImage {
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
  hash: string;
}

export interface ClipboardWatcherOptions {
  /** Primary watched folder; captures are written to its top level. */
  folder: string;
  intervalMs?: number;
  /** Pre-detected tool; when omitted one is probed at start(). */
  tool?: ClipboardTool | null;
  exec?: ExecBuffer;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  now?: () => Date;
  /** Called after each capture (used for logging and re-indexing). */
  onCapture?: (image: CapturedImage) => void;
}

/**
 * Polls the clipboard and saves newly-copied images into the watched folder.
 *
 * Captures go to the top level of the folder (not a subfolder) so the folder
 * watcher indexes them and `latest` / `list_images` see them immediately.
 */
export class ClipboardWatcher {
  private readonly folder: string;
  private readonly intervalMs: number;
  private readonly exec: ExecBuffer;
  private readonly writeFile: (path: string, data: Buffer) => Promise<void>;
  private readonly now: () => Date;
  private readonly onCapture?: (image: CapturedImage) => void;

  private tool: ClipboardTool | null;
  private timer: NodeJS.Timeout | null = null;
  /** Hash of the last image seen on the clipboard. */
  private lastHash: string | null = null;
  private polling = false;

  constructor(options: ClipboardWatcherOptions) {
    this.folder = options.folder;
    this.intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_CLIPBOARD_INTERVAL_MS);
    this.tool = options.tool ?? null;
    this.exec = options.exec ?? execBuffer;
    this.writeFile = options.writeFile ?? ((path, data) => writeFileDefault(path, data));
    this.now = options.now ?? (() => new Date());
    this.onCapture = options.onCapture;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  get toolName(): string | null {
    return this.tool?.name ?? null;
  }

  /**
   * Detect a clipboard tool and begin polling.
   *
   * An image that is already on the clipboard when the server starts is treated
   * as a baseline and not captured, so starting the server never silently
   * harvests whatever the user copied earlier.
   *
   * @returns true when polling started.
   */
  async start(): Promise<boolean> {
    if (this.timer) return true;

    if (!this.tool) {
      this.tool = await detectClipboardTool(this.exec);
    }
    if (!this.tool) return false;

    await this.takeBaseline();

    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.intervalMs);
    this.timer.unref?.();

    return true;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check the clipboard once. Writes a capture only when the image differs from
   * the previously seen one, so an image that stays on the clipboard is not
   * re-saved on every poll.
   *
   * @returns the capture, or null when there was nothing new.
   */
  async pollOnce(): Promise<CapturedImage | null> {
    if (!this.tool || this.polling) return null;
    this.polling = true;

    try {
      const target = await this.currentImageTarget();
      if (!target) {
        // The clipboard now holds something else, so a later copy of the same
        // image should be captured again.
        this.lastHash = null;
        return null;
      }

      const bytes = await this.readTarget(target);
      if (!bytes || bytes.length === 0) return null;

      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash === this.lastHash) return null;
      this.lastHash = hash;

      const name = `clipboard-${captureStamp(this.now())}${target.extension}`;
      const path = join(this.folder, name);
      await this.writeFile(path, bytes);

      const captured: CapturedImage = {
        path,
        name,
        mimeType: target.mimeType,
        bytes: bytes.length,
        hash,
      };
      this.onCapture?.(captured);
      return captured;
    } catch (error) {
      // A clipboard read can fail whenever the owning application is busy or
      // has exited; that is normal and must never break the server.
      console.error(`[Clipboard] Read failed: ${errorMessage(error)}`);
      return null;
    } finally {
      this.polling = false;
    }
  }

  /** Record what is already on the clipboard without saving it. */
  private async takeBaseline(): Promise<void> {
    try {
      const target = await this.currentImageTarget();
      if (!target) return;

      const bytes = await this.readTarget(target);
      if (bytes && bytes.length > 0) {
        this.lastHash = createHash("sha256").update(bytes).digest("hex");
      }
    } catch {
      // Nothing on the clipboard, or it could not be read: nothing to baseline.
    }
  }

  /** The best image target the clipboard currently advertises. */
  private async currentImageTarget(): Promise<ImageTarget | null> {
    if (!this.tool) return null;

    const listing = await this.exec(this.tool.name, this.tool.targetsArgs, PROBE_TIMEOUT_MS);
    return pickImageTarget(listing.toString("utf8").split(/\r?\n/));
  }

  private async readTarget(target: ImageTarget): Promise<Buffer | null> {
    if (!this.tool) return null;
    return this.exec(this.tool.name, this.tool.readArgs(target.target), READ_TIMEOUT_MS);
  }
}

