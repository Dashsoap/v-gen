import { GoogleGenAI } from "@google/genai";
import type {
  VideoGenerator,
  VideoGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";

export class GoogleVeoGenerator implements VideoGenerator {
  private apiKey: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || "veo-2.0-generate-001";
  }

  async generate(params: VideoGenerateParams): Promise<GenerateResult> {
    const model = params.model || this.defaultModel;
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const config = {
      numberOfVideos: 1,
      durationSeconds: params.durationMs ? Math.round(params.durationMs / 1000) : 5,
      personGeneration: "allow_all" as const,
    };

    // Submit async video generation (with retry for 429/5xx)
    let operation = await withRetry(async () => {
      if (params.imageUrl) {
        // Image-to-video: download image and convert to base64
        const imageRes = await fetch(params.imageUrl);
        if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
        const imageBase64 = imageBuffer.toString("base64");
        const mimeType = imageRes.headers.get("content-type") || "image/png";

        return ai.models.generateVideos({
          model,
          image: {
            imageBytes: imageBase64,
            mimeType,
          },
          prompt: params.prompt || "Animate this image with subtle, natural motion",
          config,
        });
      } else {
        return ai.models.generateVideos({
          model,
          prompt: params.prompt || "Generate a cinematic video",
          config,
        });
      }
    }, { label: `veo-submit:${model}` });

    // Poll for completion (max 10 minutes, check every 10s)
    for (let i = 0; i < 60; i++) {
      if (operation.done) break;
      await new Promise((r) => setTimeout(r, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (!operation.done) {
      throw new Error("Google Veo video generation timed out");
    }

    // Extract video URL from response
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video?.uri) {
      throw new Error("Google Veo returned no video");
    }

    return {
      url: video.uri,
    };
  }
}
