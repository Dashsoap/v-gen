import type {
  ImageGenerator,
  ImageGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";

export class FalImageGenerator implements ImageGenerator {
  private apiKey: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || "fal-ai/flux/schnell";
  }

  async generate(params: ImageGenerateParams): Promise<GenerateResult> {
    const model = params.model || this.defaultModel;

    return withRetry(async () => {
      const response = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: params.prompt,
          image_size: {
            width: params.width || 1024,
            height: params.height || 1024,
          },
          num_images: 1,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        const error = await response.text();
        const err = new Error(`FAL image generation failed (${status}): ${error}`);
        (err as unknown as Record<string, unknown>).status = status;
        throw err;
      }

      const data = await response.json();
      return {
        url: data.images?.[0]?.url,
      };
    }, { label: `fal-image:${model}` });
  }
}
