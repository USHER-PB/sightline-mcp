import { VisionBackend } from "./vision-backend.js";
import { GeminiVisionBackend, DEFAULT_GEMINI_MODEL, GEMINI_MODEL_ENV } from "./gemini-backend.js";
import { OllamaVisionBackend, OLLAMA_BASE_URL_ENV, OLLAMA_MODEL_ENV } from "./ollama-backend.js";
import { errorMessage, SightlineError } from "./errors.js";
import { EnvLike, readNonNegativeIntEnv, readOptionalEnv, readPositiveIntEnv } from "./env.js";
import { RequestThrottle, ThrottleOptions, ThrottleStats } from "./throttle.js";
import { DescribeRequest } from "./vision-backend.js";

export type BackendType = "gemini" | "ollama";

export const BACKEND_TYPES: BackendType[] = ["gemini", "ollama"];
export const BACKEND_ORDER_ENV = "SIGHTLINE_BACKENDS";
export const MAX_CONCURRENT_ENV = "SIGHTLINE_MAX_CONCURRENT";
export const MIN_INTERVAL_ENV = "SIGHTLINE_MIN_INTERVAL_MS";

export const DEFAULT_MAX_CONCURRENT = 1;
export const DEFAULT_MIN_INTERVAL_MS = 0;

export interface BackendManagerConfig {
  /** Preferred backend order (first = primary, rest = fallbacks) */
  backends: BackendType[];
  /** Gemini API key (required if using Gemini) */
  geminiApiKey?: string;
  /** Gemini model (default: gemini-2.5-flash) */
  geminiModel?: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string;
  /** Ollama vision model (default: moondream) */
  ollamaModel?: string;
}

/** Builds a backend, or returns null when it is not configured at all. */
export type BackendFactory = (
  type: BackendType,
  config: BackendManagerConfig
) => VisionBackend | null;

export interface BackendStatus {
  name: string;
  available: boolean;
  note?: string;
}

export interface DescribeResult {
  description: string;
  backend: string;
}

const DEFAULT_FACTORIES: Record<BackendType, BackendFactory> = {
  gemini: (_type, config) => {
    if (!config.geminiApiKey) return null;
    return new GeminiVisionBackend({
      apiKey: config.geminiApiKey,
      model: config.geminiModel || DEFAULT_GEMINI_MODEL,
    });
  },
  ollama: (_type, config) =>
    new OllamaVisionBackend({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
    }),
};

/**
 * Manages multiple vision backends with automatic fallback.
 */
export class BackendManager {
  private readonly backends: VisionBackend[] = [];
  private readonly availability = new Map<string, BackendStatus>();
  private readonly throttle: RequestThrottle;
  private currentBackendIndex = 0;

  constructor(
    config: BackendManagerConfig,
    factories: Partial<Record<BackendType, BackendFactory>> = DEFAULT_FACTORIES,
    throttleOptions: ThrottleOptions = {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    }
  ) {
    this.throttle = new RequestThrottle(throttleOptions);
    for (const backendType of config.backends) {
      const factory = factories[backendType];

      if (!factory) {
        console.error(
          `[Sightline] Unknown backend "${backendType}" in ${BACKEND_ORDER_ENV}, ignoring it.`
        );
        continue;
      }

      try {
        const backend = factory(backendType, config);
        if (!backend) {
          console.error(`[Sightline] Backend ${backendType} is not configured, skipping it.`);
          continue;
        }

        this.backends.push(backend);
        this.availability.set(backend.name, { name: backend.name, available: true });
      } catch (error) {
        console.error(
          `[Sightline] Backend ${backendType} could not be created: ${errorMessage(error)}`
        );
      }
    }

    if (this.backends.length === 0) {
      throw new Error(
        "No vision backends available. Set GEMINI_API_KEY or start Ollama (ollama serve)."
      );
    }
  }

  /**
   * Probe every registered backend so startup logs reflect reality. A backend
   * whose provider is down is kept registered (it may come back), but is
   * reported as unavailable.
   */
  static async create(
    config: BackendManagerConfig,
    factories: Partial<Record<BackendType, BackendFactory>> = DEFAULT_FACTORIES,
    throttleOptions?: ThrottleOptions
  ): Promise<BackendManager> {
    const manager = new BackendManager(config, factories, throttleOptions);
    await manager.refreshAvailability();
    return manager;
  }

  async refreshAvailability(): Promise<BackendStatus[]> {
    for (const backend of this.backends) {
      if (!backend.probe) continue;

      try {
        const available = await backend.probe();
        this.availability.set(backend.name, {
          name: backend.name,
          available,
          note: available ? undefined : "probe failed",
        });
      } catch (error) {
        this.availability.set(backend.name, {
          name: backend.name,
          available: false,
          note: errorMessage(error),
        });
      }
    }
    return this.describeBackends();
  }

  /**
   * The backend that served the most recent request.
   */
  get currentBackend(): VisionBackend {
    return this.backends[this.currentBackendIndex] ?? this.backends[0];
  }

  /**
   * Analyze one or more images, falling back to the next backend on failure.
   * Failures from every backend are reported, not just the last one. Calls are
   * serialised through the throttle so parallel tool calls cannot exhaust an
   * API quota or thrash a local model.
   */
  async describe(request: DescribeRequest): Promise<DescribeResult> {
    if (request.images.length === 0) {
      throw new SightlineError("invalid_input", "At least one image is required.");
    }

    return this.throttle.run(() => this.runWithFallback(request));
  }

  private async runWithFallback(request: DescribeRequest): Promise<DescribeResult> {
    const failures: string[] = [];

    for (let i = 0; i < this.backends.length; i++) {
      const backend = this.backends[i];

      try {
        const description = await backend.describe(request);
        this.currentBackendIndex = i;
        this.availability.set(backend.name, { name: backend.name, available: true });
        return { description, backend: backend.name };
      } catch (error) {
        const message = errorMessage(error);
        failures.push(`${backend.name}: ${message}`);
        this.availability.set(backend.name, {
          name: backend.name,
          available: false,
          note: message,
        });
        console.error(`[Sightline] Backend ${backend.name} failed: ${message}`);

        if (i < this.backends.length - 1) {
          console.error(`[Sightline] Falling back to ${this.backends[i + 1].name}`);
        }
      }
    }

    throw new SightlineError(
      "backend_unavailable",
      `All vision backends failed.\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
      "Check GEMINI_API_KEY / internet access, or run 'ollama serve' with a vision model installed."
    );
  }

  /**
   * Current throttle state, for startup logging and diagnostics.
   */
  throttleStats(): ThrottleStats {
    return this.throttle.stats();
  }

  /**
   * Names of every registered backend, in priority order.
   */
  listBackends(): string[] {
    return this.backends.map((backend) => backend.name);
  }

  /**
   * Registered backends with their last known availability.
   */
  describeBackends(): BackendStatus[] {
    return this.backends.map(
      (backend) => this.availability.get(backend.name) ?? { name: backend.name, available: true }
    );
  }

}

/**
 * Parse `SIGHTLINE_BACKENDS`, warning about anything unrecognized.
 */
export function parseBackendOrder(
  raw: string | undefined,
  geminiApiKey: string | undefined
): BackendType[] {
  const fallback: BackendType[] = geminiApiKey ? ["gemini", "ollama"] : ["ollama"];

  if (!raw) return fallback;

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  const valid = parsed.filter((entry): entry is BackendType =>
    (BACKEND_TYPES as string[]).includes(entry)
  );

  const unknown = parsed.filter((entry) => !(BACKEND_TYPES as string[]).includes(entry));
  if (unknown.length > 0) {
    console.error(
      `[Sightline] Ignoring unknown backend(s) in ${BACKEND_ORDER_ENV}: ${unknown.join(", ")}. Valid values: ${BACKEND_TYPES.join(", ")}.`
    );
  }

  return valid.length > 0 ? valid : fallback;
}

/**
 * Create a backend manager from environment configuration.
 */
export function createBackendManager(
  env: EnvLike = process.env,
  factories: Partial<Record<BackendType, BackendFactory>> = DEFAULT_FACTORIES
): Promise<BackendManager> {
  const geminiApiKey = readOptionalEnv("GEMINI_API_KEY", env);
  const backendOrder = parseBackendOrder(readOptionalEnv(BACKEND_ORDER_ENV, env), geminiApiKey);

  return BackendManager.create(
    {
      backends: backendOrder,
      geminiApiKey,
      geminiModel: readOptionalEnv(GEMINI_MODEL_ENV, env),
      ollamaBaseUrl: readOptionalEnv(OLLAMA_BASE_URL_ENV, env),
      ollamaModel: readOptionalEnv(OLLAMA_MODEL_ENV, env),
    },
    factories,
    {
      maxConcurrent: readPositiveIntEnv(MAX_CONCURRENT_ENV, DEFAULT_MAX_CONCURRENT, env),
      minIntervalMs: readNonNegativeIntEnv(MIN_INTERVAL_ENV, DEFAULT_MIN_INTERVAL_MS, env),
    }
  );
}

