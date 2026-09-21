import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";
import { VisionBackend, GeminiOptions } from "./vision-backend.js";

/**
 * Gemini API implementation of the vision backend
 */
export class GeminiVisionBackend implements VisionBackend {
  readonly name = "Gemini";
  readonly isAvailable: boolean;
  private model: GenerativeModel;

  constructor(apiKey: string, options?: Partial<GeminiOptions>) {
    if (!apiKey) {
      this.isAvailable = false;
      throw new Error("GEMINI_API_KEY is required for Gemini backend");
    }
    
    this.isAvailable = true;
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ 
      model: options?.model || "gemini-2.5-flash" 
    });
  }

  async describe(
    imageBase64: string,
    prompt: string,
    mimeType: string = "image/png"
  ): Promise<string> {
    const imagePart: Part = {
      inlineData: {
        data: imageBase64,
        mimeType,
      },
    };

    try {
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      return response.text();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini API error: ${errorMessage}`);
    }
  }
}
