/**
 * Vision backend interface - enables pluggable vision providers
 */
export interface VisionBackend {
  readonly name: string;
  readonly isAvailable: boolean;
  
  /**
   * Analyze an image and return a text description
   * @param imageBase64 - Base64-encoded image data
   * @param prompt - The analysis prompt
   * @param mimeType - MIME type of the image (e.g., "image/png")
   * @returns Text description of the image
   */
  describe(imageBase64: string, prompt: string, mimeType?: string): Promise<string>;
}

/**
 * Backend configuration
 */
export interface BackendConfig {
  /** Backend type: "gemini" | "ollama" */
  type: string;
  /** Whether this backend is enabled */
  enabled: boolean;
  /** Backend-specific options */
  options?: Record<string, unknown>;
}

/**
 * Gemini backend options
 */
export interface GeminiOptions {
  apiKey: string;
  model?: string;
}

/**
 * Ollama backend options
 */
export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
}
