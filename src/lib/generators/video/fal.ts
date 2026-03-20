import type {
  VideoGenerator,
  VideoGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";

export class FalVideoGenerator implements VideoGenerator {
  private apiKey: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || "fal-ai/kling-video/v1/standard/image-to-video";
  }

  async generate(params: VideoGenerateParams): Promise<GenerateResult> {
    const model = params.model || this.defaultModel;

    // Submit async job (with retry for 429/5xx)
    const submitData = await withRetry(async () => {
      const submitResponse = await fetch(`https://queue.fal.run/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: params.imageUrl,
          prompt: params.prompt || "",
          duration: params.durationMs ? Math.round(params.durationMs / 1000) : 5,
          ...(params.lastFrameImageUrl ? { tail_image_url: params.lastFrameImageUrl } : {}),
        }),
      });

      if (!submitResponse.ok) {
        const status = submitResponse.status;
        const error = await submitResponse.text();
        const err = new Error(`FAL video generation failed (${status}): ${error}`);
        (err as unknown as Record<string, unknown>).status = status;
        throw err;
      }

      return submitResponse.json();
    }, { label: `fal-video-submit:${model}` });

    // Poll for result
    const requestId = submitData.request_id;
    const resultUrl = `https://queue.fal.run/${model}/requests/${requestId}`;

    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusRes = await fetch(`${resultUrl}/status`, {
        headers: { Authorization: `Key ${this.apiKey}` },
      });
      const status = await statusRes.json();

      if (status.status === "COMPLETED") {
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${this.apiKey}` },
        });
        const result = await resultRes.json();
        return {
          url: result.video?.url,
          externalId: requestId,
        };
      }

      if (status.status === "FAILED") {
        throw new Error(`FAL video generation failed: ${status.error}`);
      }
    }

    throw new Error("FAL video generation timed out");
  }
}
