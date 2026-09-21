import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";

/**
 * Vision backend interface - designed for pluggable backends in future phases
 */
export interface VisionBackend {
  describe(imageBase64: string, prompt: string, mimeType?: string): Promise<string>;
}

/**
 * Gemini API implementation of the vision backend
 */
export class GeminiVisionBackend implements VisionBackend {
  private model: GenerativeModel;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use Gemini 2.5 Flash for good balance of speed and quality
    this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
