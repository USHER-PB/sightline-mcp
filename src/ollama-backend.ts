import { errorMessage } from "./errors.js";
import { VisionBackend, OllamaOptions } from "./vision-backend.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "moondream";
export const OLLAMA_BASE_URL_ENV = "OLLAMA_BASE_URL";
export const OLLAMA_MODEL_ENV = "OLLAMA_VISION_MODEL";

/** Model families that can actually accept images. */
const VISION_MODEL_HINTS = ["moondream", "llava", "bakllava", "cogvlm"];

/**
 * Ollama implementation of the vision backend.
 * Supports local models like LLaVA, Moondream, BakLLaVA.
 */
export class OllamaVisionBackend implements VisionBackend {
  readonly name = "Ollama";
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options?: OllamaOptions) {
    this.baseUrl = options?.baseUrl || process.env[OLLAMA_BASE_URL_ENV] || DEFAULT_OLLAMA_BASE_URL;
    this.model = options?.model || process.env[OLLAMA_MODEL_ENV] || DEFAULT_OLLAMA_MODEL;
  }

  get baseURL(): string {
    return this.baseUrl;
  }

  get visionModel(): string {
    return this.model;
  }

  async describe(
    imageBase64: string,
    prompt: string,
    _mimeType: string = "image/png"
  ): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          images: [imageBase64],
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as { response?: string };
      return data.response || "No response from Ollama";
    } catch (error) {
      throw new Error(this.describeFailure(error));
    }
  }

  /**
   * Turn a raw failure into an actionable message (connection refused vs. an
   * error reported by the Ollama server itself).
   */
  private describeFailure(error: unknown): string {
    const message = errorMessage(error);

    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return `Ollama not running at ${this.baseUrl}. Start Ollama with: ollama serve`;
    }

    if (message.startsWith("Ollama API error")) {
      return message;
    }

    return `Ollama error: ${message}`;
  }

  /**
   * Check whether Ollama is reachable and the configured vision model is
   * installed.
   */
  async probe(): Promise<boolean> {
    const models = await this.listModels();
    if (models.length === 0) return false;
    return models.some((name) => name.includes(this.model));
  }

  /**
   * All installed Ollama models that look vision-capable.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = (await response.json()) as { models?: { name?: string }[] };
      const models = data.models ?? [];

      return models
        .map((model) => model.name ?? "")
        .filter((name) => VISION_MODEL_HINTS.some((hint) => name.includes(hint)));
    } catch {
      return [];
    }
  }
}
