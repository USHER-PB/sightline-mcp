import { createHash } from "crypto";

export interface CacheEntry {
  hash: string;
  prompt: string;
  description: string;
  timestamp: number;
  mimeType: string;
}

export class ImageCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 24 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate a hash key from image data and prompt
   */
  private generateKey(imageBase64: string, prompt: string): string {
    const hash = createHash("sha256");
    hash.update(imageBase64);
    hash.update(prompt);
    return hash.digest("hex");
  }

  /**
   * Check if an entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Get cached description if available and not expired
   */
  get(imageBase64: string, prompt: string): CacheEntry | null {
    const key = this.generateKey(imageBase64, prompt);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Store a description in the cache
   */
  set(imageBase64: string, prompt: string, description: string, mimeType: string): void {
    const key = this.generateKey(imageBase64, prompt);

    // Evict oldest entries if at max size
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      hash: key.substring(0, 16),
      prompt,
      description,
      timestamp: Date.now(),
      mimeType,
    });
  }

  /**
   * Clear all expired entries
   */
  clearExpired(): number {
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

// Global cache instance
export const imageCache = new ImageCache(
  parseInt(process.env.SIGHTLINE_CACHE_MAX_SIZE || "100", 10),
  parseInt(process.env.SIGHTLINE_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10)
);
