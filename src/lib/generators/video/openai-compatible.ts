import type {
  VideoGenerator,
  VideoGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { createScopedLogger } from "@/lib/logging";
import { withRetry } from "@/lib/retry";

const logger = createScopedLogger({ module: "openai-video-generator" });

/**
 * OpenAI-compatible video generator.
 *
 * Supports three API patterns:
 * 1. Sora → POST /v1/responses (OpenAI Responses API)
 * 2. Proxy video relay → POST /v1/chat/completions with image_url at root level
 *    (NewAPI/OneAPI/SiliconFlow proxies for Veo, Kling, Wan, etc.)
 * 3. Legacy chat completions → multimodal content array (Grok, etc.)
 */
export class OpenAIVideoGenerator implements VideoGenerator {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/v1\/?$/, "");
    this.defaultModel = config.model || "sora";
  }

  async generate(params: VideoGenerateParams): Promise<GenerateResult> {
    const model = params.model || this.defaultModel;

    // Sora uses the Responses API
    if (model === "sora") {
      return this.generateViaSoraApi(model, params);
    }

    // All other video models use the proxy-compatible format
    return this.generateViaProxy(model, params);
  }

  /**
   * Sora: POST /v1/responses
   * Supports multiple reference images via input_image entries.
   */
  private async generateViaSoraApi(
    model: string,
    params: VideoGenerateParams,
  ): Promise<GenerateResult> {
    const content: Array<Record<string, unknown>> = [];

    for (const ref of params.referenceImages || []) {
      content.push({ type: "input_image", image_url: ref.url });
    }

    content.push({ type: "input_image", image_url: params.imageUrl });
    content.push({
      type: "input_text",
      text: params.prompt || "Animate this image with subtle motion",
    });

    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [{ role: "user", content }],
        }),
      });

      if (!response.ok) {
        const status = response.status;
        const error = await response.text();
        const err = new Error(`OpenAI video generation failed (${status}): ${error}`);
        (err as unknown as Record<string, unknown>).status = status;
        throw err;
      }

      const data = await response.json();
      const videoOutput = data.output?.find(
        (o: { type: string }) => o.type === "video_generation_call",
      );

      return {
        externalId: videoOutput?.id,
      };
    }, { label: `sora-video:${model}` });
  }

  /**
   * Proxy-compatible video generation via POST /v1/chat/completions.
   *
   * For NewAPI/OneAPI/SiliconFlow proxies routing Veo, Kling, Wan, etc.:
   * - Text prompt goes in messages[0].content as plain string
   * - Image URL goes as root-level `image_url` field (proxy convention)
   * - Last frame image URL goes as root-level `image_url_2` or `last_frame_image` field
   * - Proxy detects the video model and handles upstream API internally
   *
   * Response URL may come from:
   * - choices[0].message.content (as URL text or markdown link)
   * - data[0].url (OpenAI images-style response)
   */
  private async generateViaProxy(
    model: string,
    params: VideoGenerateParams,
  ): Promise<GenerateResult> {
    const prompt = params.prompt || "Animate this image with subtle, natural motion";

    // Build request body — proxy format: text prompt + image at root level
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
    };

    // Image URL at root level (proxy convention for image-to-video)
    if (params.imageUrl) {
      body.image_url = params.imageUrl;
    }

    // Last frame image for first-last-frame mode
    if (params.lastFrameImageUrl) {
      body.image_url_2 = params.lastFrameImageUrl;
    }

    logger.info("Sending proxy video request", {
      model,
      hasImage: !!params.imageUrl,
      hasLastFrame: !!params.lastFrameImageUrl,
      promptLength: prompt.length,
    });

    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const status = response.status;
        const error = await response.text();
        const err = new Error(`Video generation failed (${status}): ${error}`);
        (err as unknown as Record<string, unknown>).status = status;
        throw err;
      }

      const data = await response.json();

      logger.info("Proxy video response received", {
        model,
        hasChoices: !!data.choices?.length,
        hasData: !!data.data?.length,
        responseKeys: Object.keys(data),
      });

      return this.extractVideoUrl(data);
    }, { label: `proxy-video:${model}` });
  }

  /**
   * Extract video URL from various response formats.
   */
  private extractVideoUrl(data: Record<string, unknown>): GenerateResult {
    // Priority 0: data[0].url (OpenAI images-style, many proxies use this)
    const dataArr = data.data as Array<Record<string, unknown>> | undefined;
    if (dataArr?.[0]?.url) {
      return { url: dataArr[0].url as string };
    }
    if (dataArr?.[0]?.b64_json) {
      return { base64: dataArr[0].b64_json as string };
    }

    // Extract from message content
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const messageContent = (message?.content || "") as string;

    if (!messageContent) {
      throw new Error("Video generation returned empty response");
    }

    const cleanUrl = (raw: string) => raw.replace(/[)\]}>.,;!?]+$/, "");

    // Priority 1: direct URL (content is just a URL)
    if (messageContent.trim().startsWith("http")) {
      return { url: cleanUrl(messageContent.trim().split(/\s/)[0]) };
    }

    // Priority 2: markdown link — [text](url)
    const mdLinkMatch = messageContent.match(/\[.*?\]\((https?:\/\/[^)]+)\)/i);
    if (mdLinkMatch) {
      return { url: cleanUrl(mdLinkMatch[1]) };
    }

    // Priority 3: explicit video file extensions
    const videoExtMatch = messageContent.match(/https?:\/\/[^\s"'<>()[\]]+\.(mp4|webm|mov|avi|mkv)[^\s"'<>()[\]]*/i);
    if (videoExtMatch) {
      return { url: cleanUrl(videoExtMatch[0]) };
    }

    // Priority 4: any URL (proxies often return a CDN URL without obvious extension)
    const anyUrlMatch = messageContent.match(/https?:\/\/[^\s"'<>()[\]]{10,}/i);
    if (anyUrlMatch) {
      return { url: cleanUrl(anyUrlMatch[0]) };
    }

    logger.error("Failed to extract video URL from response", {
      contentPreview: messageContent.slice(0, 300),
      responseKeys: Object.keys(data),
    });

    throw new Error(`Video generation returned no video URL. Response: ${messageContent.slice(0, 200)}`);
  }
}
