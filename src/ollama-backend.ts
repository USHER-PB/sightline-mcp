import { VisionBackend, OllamaOptions } from "./vision-backend.js";

/**
 * Ollama implementation of the vision backend
 * Supports local models like LLaVA, Moondream, BakLLaVA
 */
export class OllamaVisionBackend implements VisionBackend {
  readonly name = "Ollama";
  readonly isAvailable: boolean;
  private baseUrl: string;
  private model: string;

  constructor(options?: Partial<OllamaOptions>) {
    this.baseUrl = options?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.model = options?.model || process.env.OLLAMA_VISION_MODEL || "moondream";
    this.isAvailable = true; // Will be checked on first use
  }

  async describe(
    imageBase64: string,
    prompt: string,
    mimeType: string = "image/png"
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

      const data = await response.json();
      return data.response || "No response from Ollama";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a connection error
      if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
        throw new Error(
          `Ollama not running at ${this.baseUrl}. Start Ollama with: ollama serve`
        );
      }
      
      throw new Error(`Ollama error: ${errorMessage}`);
    }
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;
      
      const data = await response.json();
      const models = data.models || [];
      return models.some((m: { name: string }) => 
        m.name.includes(this.model) || m.name.includes("moondream") || m.name.includes("llava")
      );
    } catch {
      return false;
    }
  }

  /**
   * List available vision models in Ollama
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      
      const data = await response.json();
      const models = data.models || [];
      
      // Filter for vision-capable models
      const visionModels = models.filter((m: { name: string }) => 
        m.name.includes("moondream") || 
        m.name.includes("llava") || 
        m.name.includes("bakllava") ||
        m.name.includes("cogvlm")
      );
      
      return visionModels.map((m: { name: string }) => m.name);
    } catch {
      return [];
    }
  }
}
