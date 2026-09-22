import { createHash } from "crypto";
import { EnvLike, readPositiveIntEnv } from "./env.js";

export interface CacheEntry {
  hash: string;
  prompt: string;
  description: string;
  timestamp: number;
  mimeType: string;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  ttlMs: number;
  hits: number;
  misses: number;
  expirations: number;
  evictions: number;
}

export interface ImageCacheOptions {
  /** Maximum number of cached results before the least-recently-used entry is dropped. */
  maxSize: number;
  /** How long a cached result stays valid. */
  ttlMs: number;
  /** Injectable clock, used by tests. */
  now: () => number;
}

export const DEFAULT_CACHE_MAX_SIZE = 100;
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory, least-recently-used cache of vision results. A hit requires the
 * same image bytes *and* the same prompt, so switching analysis mode never
 * returns another mode's description.
 */
export class ImageCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private hits = 0;
  private misses = 0;
  private expirations = 0;
  private evictions = 0;

  constructor(options: Partial<ImageCacheOptions> = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_CACHE_MAX_SIZE;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private generateKey(imageBase64: string, prompt: string): string {
    const hash = createHash("sha256");
    hash.update(imageBase64);
    hash.update(prompt);
    return hash.digest("hex");
  }

  private isExpired(entry: CacheEntry): boolean {
    return this.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Get a cached description, refreshing the entry's recency on a hit.
   */
  get(imageBase64: string, prompt: string): CacheEntry | null {
    const key = this.generateKey(imageBase64, prompt);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.expirations++;
      this.misses++;
      return null;
    }

    // Re-insert so the most recently used entry moves to the end of the Map.
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  /**
   * Store a description, evicting the least-recently-used entry when full.
   */
  set(imageBase64: string, prompt: string, description: string, mimeType: string): void {
    const key = this.generateKey(imageBase64, prompt);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      this.evictions++;
    }

    this.cache.set(key, {
      hash: key.substring(0, 16),
      prompt,
      description,
      timestamp: this.now(),
      mimeType,
    });
  }

  /**
   * Drop every expired entry.
   * @returns how many entries were removed.
   */
  clearExpired(): number {
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.expirations++;
        cleared++;
      }
    }
    return cleared;
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      expirations: this.expirations,
      evictions: this.evictions,
    };
  }

  /**
   * Periodically purge expired entries so the cache does not hold dead results
   * until the next lookup. The timer is unref'd so it never keeps the process
   * alive on its own.
   * @returns a function that stops the janitor.
   */
  startJanitor(intervalMs?: number): () => void {
    const interval = intervalMs ?? Math.max(1000, Math.min(this.ttlMs, 60 * 60 * 1000));
    const timer = setInterval(() => {
      const cleared = this.clearExpired();
      if (cleared > 0) {
        console.error(`[ImageCache] Cleared ${cleared} expired entr${cleared === 1 ? "y" : "ies"}`);
      }
    }, interval);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

/**
 * Build a cache from the environment, falling back to safe defaults for
 * missing or malformed values.
 */
export function createImageCacheFromEnv(env: EnvLike = process.env): ImageCache {
  return new ImageCache({
    maxSize: readPositiveIntEnv("SIGHTLINE_CACHE_MAX_SIZE", DEFAULT_CACHE_MAX_SIZE, env),
    ttlMs: readPositiveIntEnv("SIGHTLINE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, env),
  });
}
