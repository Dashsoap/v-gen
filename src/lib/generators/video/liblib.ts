/**
 * LiblibAI Video Generator — Kling img2video / text2video / multiImg2video
 *
 * Auth: HMAC-SHA1 signature (same as image generator).
 * Polling: POST /api/generate/status → videos[].videoUrl
 */

import crypto from "crypto";
import type {
  VideoGenerator,
  VideoGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "liblib-video" });

const BASE_URL = "https://openapi.liblibai.cloud";

// ─── Model Config ────────────────────────────────────────────────────────

interface VideoModelConfig {
  endpoint: string;
  templateUuid: string;
  /** Build generateParams from our VideoGenerateParams */
  buildParams: (params: VideoGenerateParams, model: string) => Record<string, unknown>;
}

/**
 * kling-v2-6 uses `images` array instead of `startFrame`.
 * All other models use `startFrame` for img2video.
 */
function isV26(model: string): boolean {
  return model === "kling-v2-6";
}

const VIDEO_MODELS: Record<string, VideoModelConfig> = {
  // ─── img2video (default for our pipeline: image → video) ───────────
  "kling-img2video": {
    endpoint: "/api/generate/video/kling/img2video",
    templateUuid: "180f33c6748041b48593030156d2a71d",
    buildParams: (params, model) => {
      const base: Record<string, unknown> = {
        model,
        prompt: params.prompt || "",
        promptMagic: 0,
        duration: params.durationMs ? String(Math.round(params.durationMs / 1000)) : "5",
        mode: "std",
      };

      if (isV26(model)) {
        // v2-6 uses `images` array
        base.images = [params.imageUrl];
        base.sound = "off";
      } else {
        base.startFrame = params.imageUrl;
        // endFrame only supported by kling-v1-6 in pro mode
        if (params.lastFrameImageUrl && model === "kling-v1-6") {
          base.endFrame = params.lastFrameImageUrl;
          base.mode = "pro";
        }
      }

      // kling-v2-5-turbo requires pro mode
      if (model === "kling-v2-5-turbo") {
        base.mode = "pro";
      }

      return base;
    },
  },

  // ─── text2video ────────────────────────────────────────────────────
  "kling-text2video": {
    endpoint: "/api/generate/video/kling/text2video",
    templateUuid: "61cd8b60d340404394f2a545eeaf197a",
    buildParams: (params, model) => ({
      model,
      prompt: params.prompt || "",
      promptMagic: 0,
      aspectRatio: "16:9",
      duration: params.durationMs ? String(Math.round(params.durationMs / 1000)) : "5",
      mode: model === "kling-v2-5-turbo" ? "pro" : "std",
      ...(isV26(model) ? { sound: "off" } : {}),
    }),
  },

  // ─── multiImg2video ────────────────────────────────────────────────
  "kling-multi-img": {
    endpoint: "/api/generate/video/kling/multiImg2video",
    templateUuid: "ca01e798b4424587b0dfdb98b089da05",
    buildParams: (params) => {
      // Collect all reference images + main image
      const images: string[] = [params.imageUrl];
      if (params.referenceImages) {
        for (const ref of params.referenceImages) {
          if (!images.includes(ref.url)) images.push(ref.url);
        }
      }
      return {
        prompt: params.prompt || "",
        promptMagic: 0,
        referenceImages: images,
        aspectRatio: "16:9",
        duration: params.durationMs ? String(Math.round(params.durationMs / 1000)) : "5",
        mode: "std",
      };
    },
  },
};

// Default Kling model for img2video
const DEFAULT_KLING_MODEL = "kling-v2-1";

// Map user-facing model IDs to internal routing
function resolveModelConfig(modelId: string): { config: VideoModelConfig; klingModel: string } {
  // If user specifies a routing mode explicitly
  if (modelId === "kling-text2video") {
    return { config: VIDEO_MODELS["kling-text2video"], klingModel: DEFAULT_KLING_MODEL };
  }
  if (modelId === "kling-multi-img") {
    return { config: VIDEO_MODELS["kling-multi-img"], klingModel: "kling-v1-6" };
  }

  // Default: img2video with the specified Kling model variant
  const config = VIDEO_MODELS["kling-img2video"];
  // Accept bare model names like "kling-v2-6", "kling-v2-5-turbo"
  const klingModel = modelId.startsWith("kling-") ? modelId : DEFAULT_KLING_MODEL;
  return { config, klingModel };
}

// ─── Auth (shared with image generator) ──────────────────────────────────

function generateSignature(
  uri: string,
  timestamp: number,
  nonce: string,
  secretKey: string,
): string {
  const signStr = `${uri}&${timestamp}&${nonce}`;
  const hmac = crypto.createHmac("sha1", secretKey).update(signStr).digest("base64");
  return hmac.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildAuthUrl(uri: string, accessKey: string, secretKey: string): string {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const signature = generateSignature(uri, timestamp, nonce, secretKey);
  const qs = new URLSearchParams({
    AccessKey: accessKey,
    Signature: signature,
    Timestamp: String(timestamp),
    SignatureNonce: nonce,
  }).toString();
  return `${BASE_URL}${uri}?${qs}`;
}

// ─── Generator ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // ~10 minutes

export class LiblibVideoGenerator implements VideoGenerator {
  private accessKey: string;
  private secretKey: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    const [accessKey, secretKey] = config.apiKey.split(":");
    if (!accessKey || !secretKey) {
      throw new Error("LiblibAI apiKey must be in format 'accessKey:secretKey'");
    }
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.defaultModel = config.model || DEFAULT_KLING_MODEL;
  }

  async generate(params: VideoGenerateParams): Promise<GenerateResult> {
    const modelId = params.model || this.defaultModel;
    const { config, klingModel } = resolveModelConfig(modelId);

    // Step 1: Submit video generation task
    const generateUuid = await this.submitTask(config, params, klingModel);
    logger.info("LiblibAI video task submitted", { modelId, klingModel, generateUuid });

    // Step 2: Poll for result
    return this.pollResult(generateUuid, klingModel);
  }

  private async submitTask(
    config: VideoModelConfig,
    params: VideoGenerateParams,
    klingModel: string,
  ): Promise<string> {
    const uri = config.endpoint;
    const generateParams = config.buildParams(params, klingModel);
    const body = {
      templateUuid: config.templateUuid,
      generateParams,
    };

    return withRetry(async () => {
      const url = buildAuthUrl(uri, this.accessKey, this.secretKey);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`LiblibAI video submit failed (${response.status}): ${text}`);
        (err as unknown as Record<string, unknown>).status = response.status;
        throw err;
      }

      const data = await response.json();
      if (data.code !== 0) {
        throw new Error(`LiblibAI video submit error: ${data.msg || JSON.stringify(data)}`);
      }

      const uuid = data.data?.generateUuid;
      if (!uuid) {
        throw new Error(`LiblibAI video submit returned no generateUuid: ${JSON.stringify(data)}`);
      }
      return uuid;
    }, { label: `liblib-video-submit:${klingModel}` });
  }

  private async pollResult(
    generateUuid: string,
    modelId: string,
  ): Promise<GenerateResult> {
    const statusUri = "/api/generate/status";

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const url = buildAuthUrl(statusUri, this.accessKey, this.secretKey);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateUuid }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.warn(`LiblibAI video poll failed (${response.status}): ${text}`, { generateUuid });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = await response.json();
      if (data.code !== 0) {
        logger.warn(`LiblibAI video poll error: ${data.msg}`, { generateUuid });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const status = data.data?.generateStatus;
      const pct = data.data?.percentCompleted;

      if (status === 5) {
        // Success — extract video URL
        const videoUrl = data.data?.videos?.[0]?.videoUrl;
        if (!videoUrl) {
          throw new Error("LiblibAI video generation succeeded but no videoUrl in response");
        }
        logger.info("LiblibAI video generation complete", { modelId, generateUuid });
        return { url: videoUrl, externalId: generateUuid };
      }

      if (status === 6) {
        throw new Error(
          `LiblibAI video generation failed: ${data.data?.generateMsg || "unknown"}`,
        );
      }

      if (status === 7) {
        throw new Error("LiblibAI video generation timed out (status=7)");
      }

      if (attempt % 6 === 0) {
        logger.info(`LiblibAI video polling...`, {
          generateUuid,
          status,
          percentCompleted: pct,
          attempt,
        });
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `LiblibAI video polling timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
