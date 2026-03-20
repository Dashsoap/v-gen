import OpenAI from "openai";
import type {
  ImageGenerator,
  ImageGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "openai-image" });

export class OpenAIImageGenerator implements ImageGenerator {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.defaultModel = config.model || "gpt-image-1";
  }

  async generate(params: ImageGenerateParams): Promise<GenerateResult> {
    const model = params.model || this.defaultModel;

    // Gemini/Imagen models don't support /v1/images/generations —
    // route them through chat completions instead
    if (model.includes("gemini") || model.includes("imagen")) {
      return this.generateViaChatCompletions(model, params);
    }

    return withRetry(async () => {
      const response = await this.client.images.generate({
        model,
        prompt: params.prompt,
        n: 1,
        size: this.getSize(params.width, params.height),
      });

      const data = response.data?.[0];
      if (!data?.url && !data?.b64_json) {
        logger.error("images.generate returned empty data", { model, response: JSON.stringify(response).slice(0, 500) });
        throw new Error(`Image generation returned empty result (model: ${model})`);
      }
      return {
        url: data?.url ?? undefined,
        base64: data?.b64_json ?? undefined,
      };
    }, { label: `image:${model}` });
  }

  /**
   * Generate images via chat completions endpoint.
   * Used for Gemini/Imagen models through OpenAI-compatible proxies.
   * The proxy translates chat completions to the model's native image gen API.
   */
  private async generateViaChatCompletions(
    model: string,
    params: ImageGenerateParams,
  ): Promise<GenerateResult> {
    return withRetry(async () => {
      logger.info("Generating image via chat completions", { model });

      const response = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: `Generate an image based on this description. Output ONLY the image, no text.\n\n${params.prompt}`,
          },
        ],
        max_tokens: 4096,
      });

      const choice = response.choices?.[0]?.message;
      if (!choice) {
        throw new Error(`Chat completions returned no choices (model: ${model})`);
      }

      // Case 1: Multipart content with image_url parts
      if (Array.isArray(choice.content)) {
        for (const part of choice.content as Array<Record<string, unknown>>) {
          if (part.type === "image_url" && (part.image_url as Record<string, string>)?.url) {
            const url = (part.image_url as Record<string, string>).url;
            if (url.startsWith("data:image")) {
              const base64 = url.replace(/^data:image\/[^;]+;base64,/, "");
              return { base64 };
            }
            return { url };
          }
          // Some proxies use inline_data
          if (part.type === "image" && (part as Record<string, unknown>).data) {
            return { base64: (part as Record<string, unknown>).data as string };
          }
        }
      }

      // Case 2: String content — extract base64 or URL from markdown/data URI
      const text = typeof choice.content === "string" ? choice.content : "";
      if (text) {
        // Match data URI: data:image/...;base64,...
        const dataUriMatch = text.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=\s]+)/);
        if (dataUriMatch) {
          return { base64: dataUriMatch[1].replace(/\s/g, "") };
        }

        // Match markdown image: ![...](https://...)
        const mdMatch = text.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        if (mdMatch) {
          return { url: mdMatch[1] };
        }

        // Match plain URL
        const urlMatch = text.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif)\S*)/i);
        if (urlMatch) {
          return { url: urlMatch[1] };
        }
      }

      logger.error("Chat completions returned no parseable image", {
        model,
        contentType: typeof choice.content,
        contentPreview: typeof choice.content === "string"
          ? choice.content.slice(0, 300)
          : JSON.stringify(choice.content)?.slice(0, 300),
      });
      throw new Error(`No image found in chat completions response (model: ${model})`);
    }, { label: `image-chat:${model}` });
  }

  private getSize(
    w?: number,
    h?: number
  ): "1024x1024" | "1792x1024" | "1024x1792" {
    if (w && h) {
      if (w > h) return "1792x1024";
      if (h > w) return "1024x1792";
    }
    return "1024x1024";
  }
}
