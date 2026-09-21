import { watch, FSWatcher, Stats } from "fs";
import { readFile, stat, readdir } from "fs/promises";
import { join, extname, basename } from "path";

export interface ImageInfo {
  path: string;
  name: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

export class ImageWatcher {
  private watcher: FSWatcher | null = null;
  private watchPath: string;
  private knownImages: Map<string, ImageInfo> = new Map();
  private supportedExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

  constructor(watchPath: string) {
    this.watchPath = watchPath;
  }

  /**
   * Start watching the folder for new images
   */
  async start(): Promise<void> {
    // Scan existing images first
    await this.scanFolder();

    // Set up watcher
    this.watcher = watch(
      this.watchPath,
      { persistent: false },
      async (eventType, filename) => {
        if (!filename) return;
        
        const filePath = join(this.watchPath, filename);
        const ext = extname(filename).toLowerCase();

        if (this.supportedExtensions.includes(ext)) {
          if (eventType === "rename") {
            // File added or removed
            try {
              const info = await this.getImageInfo(filePath);
              if (info) {
                this.knownImages.set(filePath, info);
                console.error(`[ImageWatcher] Detected new image: ${filename}`);
              }
            } catch {
              // File was removed
              this.knownImages.delete(filePath);
              console.error(`[ImageWatcher] Image removed: ${filename}`);
            }
          }
        }
      }
    );

    console.error(`[ImageWatcher] Watching folder: ${this.watchPath}`);
  }

  /**
   * Stop watching the folder
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Scan the folder for existing images
   */
  private async scanFolder(): Promise<void> {
    try {
      const files = await readdir(this.watchPath);
      
      for (const file of files) {
        const filePath = join(this.watchPath, file);
        const ext = extname(file).toLowerCase();

        if (this.supportedExtensions.includes(ext)) {
          const info = await this.getImageInfo(filePath);
          if (info) {
            this.knownImages.set(filePath, info);
          }
        }
      }

      console.error(`[ImageWatcher] Found ${this.knownImages.size} existing images`);
    } catch (error) {
      console.error(`[ImageWatcher] Error scanning folder: ${error}`);
    }
  }

  /**
   * Get info about a specific image file
   */
  private async getImageInfo(filePath: string): Promise<ImageInfo | null> {
    try {
      const stats: Stats = await stat(filePath);
      
      return {
        path: filePath,
        name: basename(filePath),
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * List all known images in the watched folder
   */
  listImages(): ImageInfo[] {
    return Array.from(this.knownImages.values()).sort(
      (a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()
    );
  }

  /**
   * Get the most recent image
   */
  getLatestImage(): ImageInfo | null {
    const images = this.listImages();
    return images.length > 0 ? images[0] : null;
  }

  /**
   * Read an image file and return base64 data
   */
  async readImageAsBase64(filePath: string): Promise<{ data: string; mimeType: string } | null> {
    try {
      const buffer = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };

      return {
        data: buffer.toString("base64"),
        mimeType: mimeTypes[ext] || "image/png",
      };
    } catch (error) {
      console.error(`[ImageWatcher] Error reading image: ${error}`);
      return null;
    }
  }
}
