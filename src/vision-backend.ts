/**
 * One image handed to a backend.
 */
export interface ImagePayload {
  /** Base64 payload, without any data URI prefix. */
  data: string;
  mimeType: string;
  /** Label used when the backend supports referring to images by name. */
  label?: string;
}

/**
 * A single analysis request. Multi-image requests (comparisons) carry every
 * image in one call so the model can relate them to each other.
 */
export interface DescribeRequest {
  prompt: string;
  images: ImagePayload[];
}

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
   * Analyze one or more images and return a text response.
   */
  describe(request: DescribeRequest): Promise<string>;

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
