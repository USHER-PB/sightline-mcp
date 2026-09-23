import { createHash } from "crypto";
import { EnvLike, readBoolEnv, readPositiveIntEnv, resolveCacheFile } from "./env.js";
import {
  CacheStore,
  CACHE_FILE_ENV,
  CACHE_PERSIST_ENV,
  FileCacheStore,
  PersistedCacheEntry,
} from "./cache-store.js";

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
  /** Optional backing store so results survive a restart. */
  store?: CacheStore;
  /** Debounce (ms) before a change is written to the store. */
  flushDebounceMs: number;
}

export const DEFAULT_CACHE_MAX_SIZE = 100;
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_FLUSH_DEBOUNCE_MS = 1000;

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
  private readonly store?: CacheStore;
  private readonly flushDebounceMs: number;

  private flushTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  private hits = 0;
  private misses = 0;
  private expirations = 0;
  private evictions = 0;

  constructor(options: Partial<ImageCacheOptions> = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_CACHE_MAX_SIZE;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.store = options.store;
    this.flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;

    if (this.store) this.hydrate();
  }

  /**
   * Load previously persisted results, dropping anything already expired or
   * beyond the configured size.
   */
  private hydrate(): void {
    const entries = this.store?.load() ?? [];
    const usable = entries
      .filter((entry) => this.now() - entry.timestamp <= this.ttlMs)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-this.maxSize);

    for (const entry of usable) {
      this.cache.set(entry.key, {
        hash: entry.key.substring(0, 16),
        prompt: entry.prompt,
        description: entry.description,
        timestamp: entry.timestamp,
        mimeType: entry.mimeType,
      });
    }

    if (usable.length > 0) {
      console.error(`[ImageCache] Restored ${usable.length} cached result(s) from disk`);
    }
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

    this.markDirty();
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

    if (cleared > 0) this.markDirty();
    return cleared;
  }

  clear(): void {
    this.cache.clear();
    this.markDirty();
  }

  /**
   * Write pending changes to the backing store right now.
   */
  flush(): void {
    if (!this.store || !this.dirty) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.store.save(this.snapshot());
    this.dirty = false;
  }

  /**
   * Flush pending changes and stop watching for more. Call on shutdown.
   */
  stopPersistence(): void {
    this.flush();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private markDirty(): void {
    if (!this.store) return;
    this.dirty = true;

    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushDebounceMs);
    this.flushTimer.unref?.();
  }

  private snapshot(): PersistedCacheEntry[] {
    return [...this.cache.entries()]
      .filter(([, entry]) => !this.isExpired(entry))
      .map(([key, entry]) => ({
        key,
        prompt: entry.prompt,
        description: entry.description,
        mimeType: entry.mimeType,
        timestamp: entry.timestamp,
      }));
  }

  /** Whether results are persisted to disk. */
  hasPersistence(): boolean {
    return this.store !== undefined;
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
 * missing or malformed values. Persistence is on by default; set
 * `SIGHTLINE_CACHE_PERSIST=0` for a purely in-memory cache.
 */
export function createImageCacheFromEnv(env: EnvLike = process.env): ImageCache {
  const persist = readBoolEnv(CACHE_PERSIST_ENV, true, env);
  const maxSize = readPositiveIntEnv("SIGHTLINE_CACHE_MAX_SIZE", DEFAULT_CACHE_MAX_SIZE, env);
  const ttlMs = readPositiveIntEnv("SIGHTLINE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, env);

  let store: CacheStore | undefined;
  if (persist) {
    const filePath = resolveCacheFile(env);
    store = new FileCacheStore(filePath);
    console.error(`[Sightline] Persistent cache: ${filePath} (disable with ${CACHE_PERSIST_ENV}=0)`);
  }

  return new ImageCache({ maxSize, ttlMs, store });
}

export { CACHE_FILE_ENV, CACHE_PERSIST_ENV };
