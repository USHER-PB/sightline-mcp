import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

export type EnvLike = Record<string, string | undefined>;

/** Default location for screenshots: `~/.sightline/images`. */
export const DEFAULT_WATCH_FOLDER = join(homedir(), ".sightline", "images");

/**
 * Read an environment variable, treating missing/blank values as unset.
 */
export function readOptionalEnv(name: string, env: EnvLike = process.env): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Read a positive integer environment variable. Invalid values (NaN, zero,
 * negative, fractional) fall back to the default instead of poisoning the
 * value with NaN.
 */
export function readPositiveIntEnv(
  name: string,
  fallback: number,
  env: EnvLike = process.env
): number {
  const raw = readOptionalEnv(name, env);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(
      `[Sightline] Ignoring invalid ${name}="${raw}" (expected a positive integer). Using ${fallback}.`
    );
    return fallback;
  }

  return value;
}

/**
 * Resolve the watched folder from the environment. Always returns an absolute
 * path, and falls back to `~/.sightline/images` when unset.
 */
export function resolveWatchFolder(env: EnvLike = process.env): string {
  const configured = readOptionalEnv("SIGHTLINE_WATCH_FOLDER", env);
  return configured ? resolve(configured) : DEFAULT_WATCH_FOLDER;
}

/**
 * Create a directory (recursively) if it does not exist yet.
 * @returns true when the directory was created by this call.
 */
export function ensureDirectory(dirPath: string): boolean {
  if (existsSync(dirPath)) return false;
  mkdirSync(dirPath, { recursive: true });
  return true;
}
