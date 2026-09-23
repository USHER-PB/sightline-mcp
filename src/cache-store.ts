import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { errorMessage } from "./errors.js";

/**
 * A subset of a cache entry that survives a restart. Only the hash key and the
 * model's text output are stored - never image bytes.
 */
export interface PersistedCacheEntry {
  key: string;
  prompt: string;
  description: string;
  mimeType: string;
  timestamp: number;
}

export interface CacheStore {
  load(): PersistedCacheEntry[];
  save(entries: PersistedCacheEntry[]): void;
}

export const CACHE_FILE_VERSION = 1;

interface CacheFileShape {
  version?: unknown;
  entries?: unknown;
}

/**
 * JSON-file backed cache store. Writes go to a temporary file first and are
 * renamed into place, so a crash mid-write cannot corrupt the cache.
 */
export class FileCacheStore implements CacheStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  load(): PersistedCacheEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      // No cache file yet - a first run is normal, not an error.
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as CacheFileShape;
      if (!Array.isArray(parsed.entries)) {
        console.error(`[ImageCache] Ignoring cache file ${this.filePath}: unexpected format.`);
        return [];
      }
      return parsed.entries.filter(isPersistedEntry);
    } catch (error) {
      console.error(
        `[ImageCache] Ignoring unreadable cache file ${this.filePath}: ${errorMessage(error)}`
      );
      return [];
    }
  }

  save(entries: PersistedCacheEntry[]): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const payload = JSON.stringify({ version: CACHE_FILE_VERSION, entries });
      writeFileSync(temporaryPath, payload, "utf8");
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      console.error(`[ImageCache] Could not persist cache to ${this.filePath}: ${errorMessage(error)}`);
      rmSync(`${this.filePath}.tmp`, { force: true });
    }
  }
}

export const CACHE_FILE_ENV = "SIGHTLINE_CACHE_FILE";
export const CACHE_PERSIST_ENV = "SIGHTLINE_CACHE_PERSIST";

function isPersistedEntry(value: unknown): value is PersistedCacheEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;

  return (
    typeof entry.key === "string" &&
    entry.key.length > 0 &&
    typeof entry.prompt === "string" &&
    typeof entry.description === "string" &&
    typeof entry.mimeType === "string" &&
    typeof entry.timestamp === "number" &&
    Number.isFinite(entry.timestamp)
  );
}
