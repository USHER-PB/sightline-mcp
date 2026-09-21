import { VisionBackend } from "./vision-backend.js";
import { GeminiVisionBackend } from "./gemini-backend.js";
import { OllamaVisionBackend } from "./ollama-backend.js";

export interface BackendManagerConfig {
  /** Preferred backend order (first = primary, rest = fallbacks) */
  backends: ("gemini" | "ollama")[];
  /** Gemini API key (required if using Gemini) */
  geminiApiKey?: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string;
  /** Ollama vision model (default: moondream) */
  ollamaModel?: string;
}

/**
 * Manages multiple vision backends with automatic fallback
 */
export class BackendManager {
  private backends: VisionBackend[] = [];
  private currentBackendIndex = 0;

  constructor(config: BackendManagerConfig) {
    // Initialize backends in preferred order
    for (const backendType of config.backends) {
      try {
        const backend = this.createBackend(backendType, config);
        if (backend && backend.isAvailable) {
          this.backends.push(backend);
          console.error(`[Sightline] Backend initialized: ${backend.name}`);
        }
      } catch (error) {
        console.error(`[Sightline] Backend ${backendType} not available: ${error}`);
      }
    }

    if (this.backends.length === 0) {
      throw new Error("No vision backends available. Configure GEMINI_API_KEY or start Ollama.");
    }
  }

  private createBackend(
    type: "gemini" | "ollama",
    config: BackendManagerConfig
  ): VisionBackend | null {
    switch (type) {
      case "gemini":
        if (!config.geminiApiKey) return null;
        return new GeminiVisionBackend(config.geminiApiKey);
      
      case "ollama":
        return new OllamaVisionBackend({
          baseUrl: config.ollamaBaseUrl,
          model: config.ollamaModel,
        });
      
      default:
        return null;
    }
  }

  /**
   * Get the currently active backend
   */
  get currentBackend(): VisionBackend {
    return this.backends[this.currentBackendIndex];
  }

  /**
   * Analyze an image with automatic fallback on failure
   */
  async describe(
    imageBase64: string,
    prompt: string,
    mimeType?: string
  ): Promise<{ description: string; backend: string }> {
    let lastError: Error | null = null;

    // Try each backend in order
    for (let i = 0; i < this.backends.length; i++) {
      const backend = this.backends[i];
      
      try {
        const description = await backend.describe(imageBase64, prompt, mimeType);
        this.currentBackendIndex = i; // Remember successful backend
        return { description, backend: backend.name };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Sightline] Backend ${backend.name} failed: ${lastError.message}`);
        
        // Try next backend
        if (i < this.backends.length - 1) {
          console.error(`[Sightline] Falling back to ${this.backends[i + 1].name}`);
        }
      }
    }

    // All backends failed
    throw new Error(
      `All vision backends failed. Last error: ${lastError?.message}`
    );
  }

  /**
   * List available backends
   */
  listBackends(): string[] {
    return this.backends.map((b) => b.name);
  }
}

/**
 * Create backend manager from environment configuration
 */
export function createBackendManager(): BackendManager {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  const ollamaModel = process.env.OLLAMA_VISION_MODEL;
  
  // Determine backend order from environment or use defaults
  const backendOrder = process.env.SIGHTLINE_BACKENDS?.split(",").map((s) => s.trim() as "gemini" | "ollama") 
    || (geminiApiKey ? ["gemini", "ollama"] : ["ollama"]);

  return new BackendManager({
    backends: backendOrder,
    geminiApiKey,
    ollamaBaseUrl,
    ollamaModel,
  });
}
