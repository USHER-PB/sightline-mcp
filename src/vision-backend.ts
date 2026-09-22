/**
 * Vision backend interface - enables pluggable vision providers.
 *
 * A backend does not report availability itself: whether a provider can serve
 * a request is dynamic (an API key can be missing, a local model can be
 * stopped), so the BackendManager probes it and tracks the answer.
 */
export interface VisionBackend {
  readonly name: string;

  /**
   * Analyze an image and return a text description.
   * @param imageBase64 - Base64-encoded image data (no data URI prefix)
   * @param prompt - The analysis prompt
   * @param mimeType - MIME type of the image (e.g., "image/png")
   * @returns Text description of the image
   */
  describe(imageBase64: string, prompt: string, mimeType?: string): Promise<string>;

  /**
   * Optional startup check: can this backend reach its provider right now?
   * A false or throwing probe does not unregister the backend, it only marks
   * it as currently unavailable.
   */
  probe?(): Promise<boolean>;
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
