import { watch, FSWatcher } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, join } from "path";
import { errorMessage } from "./errors.js";
import { isSupportedImageExtension } from "./image-formats.js";

export interface ImageInfo {
  path: string;
  name: string;
  /** Folder this image was found in. */
  folder: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

export interface RefreshResult {
  added: number;
  removed: number;
  total: number;
}

/**
 * Discovers image files in one or more folders. Discovery is index-based: the
 * index is rebuilt on demand by `refresh()`, and `fs.watch` is a fast path on
 * top of it, so a missed filesystem event can never leave the tool stuck with
 * a stale list.
 */
export class ImageWatcher {
  private watchers: FSWatcher[] = [];
  private readonly watchPaths: string[];
  private knownImages = new Map<string, ImageInfo>();
  private started = false;

  constructor(watchPaths: string | string[]) {
    this.watchPaths = (Array.isArray(watchPaths) ? watchPaths : [watchPaths]).map((path) =>
      path.trim()
    );
  }

  get paths(): string[] {
    return [...this.watchPaths];
  }

  get path(): string {
    return this.watchPaths[0] ?? "";
  }

  /**
   * Scan the folder and start watching it. Never throws: if the folder cannot
   * be watched, discovery still works through `refresh()`.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.refresh();
    this.openWatcher();
  }

  /**
   * Stop watching every folder.
   */
  stop(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Already closed - nothing to do.
      }
    }
    this.watchers = [];
    this.started = false;
  }

  private openWatcher(): void {
    for (const folder of this.watchPaths) {
      try {
        const watcher = watch(folder, { persistent: false }, (eventType, filename) => {
          void this.handleEvent(folder, eventType, filename);
        });

        watcher.on("error", (error) => {
          console.error(
            `[ImageWatcher] Watch error on ${folder}: ${errorMessage(error)}. Retrying.`
          );
          this.reopenWatcher();
        });

        this.watchers.push(watcher);
        console.error(`[ImageWatcher] Watching folder: ${folder}`);
      } catch (error) {
        console.error(
          `[ImageWatcher] Cannot watch ${folder}: ${errorMessage(error)}. Images are still picked up on each tool call.`
        );
      }
    }
  }

  private reopenWatcher(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore: the watchers are being replaced anyway.
      }
    }
    this.watchers = [];
    this.openWatcher();
  }

  private async handleEvent(
    folder: string,
    eventType: string,
    filename: string | null
  ): Promise<void> {
    if (!filename) {
      // Some platforms report anonymous events; rescan to stay accurate.
      await this.refresh();
      return;
    }

    if (!isSupportedImageExtension(filename)) return;

    const filePath = join(folder, filename);
    const info = await this.getImageInfo(folder, filePath);

    if (info) {
      this.knownImages.set(filePath, info);
      console.error(
        `[ImageWatcher] Detected ${eventType === "change" ? "change in" : "new image"}: ${filename}`
      );
      return;
    }

    if (this.knownImages.delete(filePath)) {
      console.error(`[ImageWatcher] Image removed: ${filename}`);
    }
  }

  /**
   * Rebuild the image index from the filesystem, dropping entries whose files
   * are gone and picking up files that appeared without a watch event. All
   * watched folders are scanned; subfolders are not.
   */
  async refresh(): Promise<RefreshResult> {
    const next = new Map<string, ImageInfo>();
    let added = 0;

    for (const folder of this.watchPaths) {
      let files: string[];
      try {
        files = await readdir(folder);
      } catch (error) {
        console.error(`[ImageWatcher] Error scanning folder ${folder}: ${errorMessage(error)}`);
        continue;
      }

      for (const file of files) {
        if (!isSupportedImageExtension(file)) continue;

        const filePath = join(folder, file);
        const info = await this.getImageInfo(folder, filePath);
        if (!info) continue;

        const previous = this.knownImages.get(filePath);
        if (
          !previous ||
          previous.size !== info.size ||
          previous.modifiedAt.getTime() !== info.modifiedAt.getTime()
        ) {
          added++;
        }

        next.set(filePath, info);
      }
    }

    const removed = [...this.knownImages.keys()].filter((path) => !next.has(path)).length;
    this.knownImages = next;

    if (added > 0 || removed > 0) {
      console.error(
        `[ImageWatcher] Scan complete: ${next.size} image(s) tracked (+${added}/-${removed})`
      );
    }

    return { added, removed, total: next.size };
  }

  /**
   * Info about a single image file, or null when it is missing or not a
   * regular file.
   */
  private async getImageInfo(folder: string, filePath: string): Promise<ImageInfo | null> {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;

      return {
        path: filePath,
        name: basename(filePath),
        folder,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * All known images, most recently modified first.
   */
  listImages(): ImageInfo[] {
    return Array.from(this.knownImages.values()).sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );
  }

  /**
   * The most recently modified image, or null when the folder has none.
   */
  getLatestImage(): ImageInfo | null {
    const images = this.listImages();
    return images.length > 0 ? images[0] : null;
  }
}
