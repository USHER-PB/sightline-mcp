import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";
import { VisionBackend, GeminiOptions } from "./vision-backend.js";
import { errorMessage } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_MODEL_ENV = "GEMINI_VISION_MODEL";

/**
 * Gemini API implementation of the vision backend.
 */
export class GeminiVisionBackend implements VisionBackend {
  readonly name = "Gemini";
  private readonly model: GenerativeModel;

  constructor(options: GeminiOptions) {
    if (!options?.apiKey) {
      throw new Error("GEMINI_API_KEY is required for the Gemini backend");
    }

    const genAI = new GoogleGenerativeAI(options.apiKey);
    this.model = genAI.getGenerativeModel({
      model: options.model || DEFAULT_GEMINI_MODEL,
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
      throw new Error(`Gemini API error: ${errorMessage(error)}`);
    }
  }
}
