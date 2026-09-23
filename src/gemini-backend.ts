import { GoogleGenerativeAI, GenerativeModel, Part } from "@google/generative-ai";
import { DescribeRequest, VisionBackend, GeminiOptions } from "./vision-backend.js";
import { errorMessage } from "./errors.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_MODEL_ENV = "GEMINI_VISION_MODEL";

/**
 * Build the Gemini request parts: the prompt followed by every image.
 * Exported so it can be tested without touching the network.
 */
export function buildGeminiRequest(request: DescribeRequest): (string | Part)[] {
  const parts: (string | Part)[] = [request.prompt];

  for (const image of request.images) {
    parts.push({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType,
      },
    });
  }

  return parts;
}

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

  async describe(request: DescribeRequest): Promise<string> {
    if (request.images.length === 0) {
      throw new Error("Gemini backend requires at least one image");
    }

    try {
      const result = await this.model.generateContent(buildGeminiRequest(request));
      const response = await result.response;
      return response.text();
    } catch (error) {
      throw new Error(`Gemini API error: ${errorMessage(error)}`);
    }
  }
}
