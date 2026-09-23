import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { delimiter, join, resolve } from "path";

export type EnvLike = Record<string, string | undefined>;

/** Default location for screenshots: `~/.sightline/images`. */
export const DEFAULT_WATCH_FOLDER = join(homedir(), ".sightline", "images");

/** Default location for the persistent cache: `~/.sightline/cache.json`. */
export const DEFAULT_CACHE_FILE = join(homedir(), ".sightline", "cache.json");

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
 * Read a boolean environment variable. Accepts 1/0, true/false, yes/no, on/off.
 */
export function readBoolEnv(name: string, fallback: boolean, env: EnvLike = process.env): boolean {
  const raw = readOptionalEnv(name, env);
  if (raw === undefined) return fallback;

  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  console.error(
    `[Sightline] Ignoring invalid ${name}="${raw}" (expected a boolean). Using ${fallback}.`
  );
  return fallback;
}

/**
 * Read a non-negative integer environment variable (0 allowed).
 */
export function readNonNegativeIntEnv(
  name: string,
  fallback: number,
  env: EnvLike = process.env
): number {
  const raw = readOptionalEnv(name, env);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(
      `[Sightline] Ignoring invalid ${name}="${raw}" (expected a non-negative integer). Using ${fallback}.`
    );
    return fallback;
  }

  return value;
}

/**
 * Split a configured list of paths. Accepts `,` and the platform path
 * delimiter (`:` on POSIX, `;` on Windows) so both `a,b` and `/one:/two` work.
 */
export function parsePathList(value: string): string[] {
  return value
    .split(",")
    .flatMap((part) => part.split(delimiter))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Resolve the watched folders from the environment. Always returns absolute
 * paths, and falls back to `~/.sightline/images` when unset.
 */
export function resolveWatchFolders(env: EnvLike = process.env): string[] {
  const configured = readOptionalEnv("SIGHTLINE_WATCH_FOLDER", env);
  if (!configured) return [DEFAULT_WATCH_FOLDER];

  const folders = parsePathList(configured).map((folder) => resolve(folder));
  return folders.length > 0 ? folders : [DEFAULT_WATCH_FOLDER];
}

/**
 * Resolve where the persistent cache file should live.
 */
export function resolveCacheFile(env: EnvLike = process.env): string {
  const configured = readOptionalEnv("SIGHTLINE_CACHE_FILE", env);
  return configured ? resolve(configured) : DEFAULT_CACHE_FILE;
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
