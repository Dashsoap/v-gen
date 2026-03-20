import crypto from "crypto";
import type {
  ImageGenerator,
  ImageGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "liblib-image" });

const BASE_URL = "https://openapi.liblibai.cloud";

// ─── Model Config ────────────────────────────────────────────────────────

interface ModelConfig {
  endpoint: string;
  templateUuid: string;
  statusEndpoint: string;
  buildBody: (params: ImageGenerateParams, templateUuid: string) => Record<string, unknown>;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "kontext-pro": {
    endpoint: "/api/generate/kontext/text2img",
    templateUuid: "fe9928fde1b4491c9b360dd24aa2b115",
    statusEndpoint: "/api/generate/status",
    buildBody: buildKontextBody,
  },
  "kontext-max": {
    endpoint: "/api/generate/kontext/text2img",
    templateUuid: "fe9928fde1b4491c9b360dd24aa2b115",
    statusEndpoint: "/api/generate/status",
    buildBody: buildKontextBody,
  },
  "star3-alpha": {
    endpoint: "/api/generate/webui/text2img/ultra",
    templateUuid: "5d7e67009b344550bc1aa6ccbfa1d7f4",
    statusEndpoint: "/api/generate/webui/status",
    buildBody: buildWebuiUltraBody,
  },
  "libdream": {
    endpoint: "/api/generate/libDream",
    templateUuid: "aa835a39c1a14cfca47c6fc941137c51",
    statusEndpoint: "/api/generate/status",
    buildBody: buildLibDreamBody,
  },
  "seedream-4": {
    endpoint: "/api/generate/seedreamV4",
    templateUuid: "0b6bad2fd350433ebb5abc7eb91f2ec9",
    statusEndpoint: "/api/generate/status",
    buildBody: buildSeedreamBody,
  },
};

// ─── Body Builders ───────────────────────────────────────────────────────

function mapAspectRatioLabel(width?: number, height?: number): string {
  if (!width || !height) return "square";
  const ratio = width / height;
  if (ratio > 1.1) return "landscape";
  if (ratio < 0.91) return "portrait";
  return "square";
}

function buildKontextBody(params: ImageGenerateParams, templateUuid: string) {
  return {
    templateUuid,
    generateParams: {
      prompt: params.prompt,
      aspectRatio: mapAspectRatioLabel(params.width, params.height),
      imgCount: 1,
    },
  };
}

function buildWebuiUltraBody(params: ImageGenerateParams, templateUuid: string) {
  return {
    templateUuid,
    generateParams: {
      prompt: params.prompt,
      aspectRatio: mapAspectRatioLabel(params.width, params.height),
      imageSize: {
        width: params.width || 1024,
        height: params.height || 1024,
      },
      imgCount: 1,
      steps: 30,
    },
  };
}

function buildLibDreamBody(params: ImageGenerateParams, templateUuid: string) {
  return {
    templateUuid,
    generateParams: {
      prompt: params.prompt,
      width: params.width || 1024,
      height: params.height || 1024,
      imgCount: 1,
    },
  };
}

function buildSeedreamBody(params: ImageGenerateParams, templateUuid: string) {
  return {
    templateUuid,
    generateParams: {
      prompt: params.prompt,
      width: params.width || 1024,
      height: params.height || 1024,
      imgCount: 1,
    },
  };
}

// ─── Auth ────────────────────────────────────────────────────────────────

function generateSignature(
  uri: string,
  timestamp: number,
  nonce: string,
  secretKey: string,
): string {
  const signStr = `${uri}&${timestamp}&${nonce}`;
  const hmac = crypto.createHmac("sha1", secretKey).update(signStr).digest("base64");
  // Make base64 URL-safe and strip trailing padding
  return hmac.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface AuthInfo {
  url: string;
  headers: Record<string, string>;
}

function buildAuthRequest(uri: string, accessKey: string, secretKey: string): AuthInfo {
  const timestamp = Date.now(); // milliseconds
  const nonce = crypto.randomUUID();
  const signature = generateSignature(uri, timestamp, nonce, secretKey);

  const queryString = new URLSearchParams({
    AccessKey: accessKey,
    Signature: signature,
    Timestamp: String(timestamp),
    SignatureNonce: nonce,
  }).toString();

  return {
    url: `${BASE_URL}${uri}?${queryString}`,
    headers: { "Content-Type": "application/json" },
  };
}

// ─── Generator ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes

export class LiblibImageGenerator implements ImageGenerator {
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
    this.defaultModel = config.model || "kontext-pro";
  }

  async generate(params: ImageGenerateParams): Promise<GenerateResult> {
    const modelId = params.model || this.defaultModel;
    const modelConfig = MODEL_CONFIGS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown LiblibAI model: ${modelId}. Available: ${Object.keys(MODEL_CONFIGS).join(", ")}`);
    }

    // Step 1: Submit generation task
    const generateUuid = await this.submitTask(modelConfig, params);
    logger.info(`LiblibAI task submitted`, { modelId, generateUuid });

    // Step 2: Poll for result
    return this.pollResult(modelConfig, generateUuid, modelId);
  }

  private async submitTask(
    modelConfig: ModelConfig,
    params: ImageGenerateParams,
  ): Promise<string> {
    const uri = modelConfig.endpoint;
    const body = modelConfig.buildBody(params, modelConfig.templateUuid);

    return withRetry(async () => {
      const auth = buildAuthRequest(uri, this.accessKey, this.secretKey);
      const response = await fetch(auth.url, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`LiblibAI submit failed (${response.status}): ${text}`);
        (err as unknown as Record<string, unknown>).status = response.status;
        throw err;
      }

      const data = await response.json();
      if (data.code !== 0) {
        throw new Error(`LiblibAI submit error: ${data.msg || JSON.stringify(data)}`);
      }

      const uuid = data.data?.generateUuid;
      if (!uuid) {
        throw new Error(`LiblibAI submit returned no generateUuid: ${JSON.stringify(data)}`);
      }
      return uuid;
    }, { label: `liblib-submit:${params.model || this.defaultModel}` });
  }

  private async pollResult(
    modelConfig: ModelConfig,
    generateUuid: string,
    modelId: string,
  ): Promise<GenerateResult> {
    const statusUri = modelConfig.statusEndpoint;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const auth = buildAuthRequest(statusUri, this.accessKey, this.secretKey);
      const response = await fetch(auth.url, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({ generateUuid }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.warn(`LiblibAI poll failed (${response.status}): ${text}`, { generateUuid });
        // Continue polling on transient errors
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = await response.json();
      if (data.code !== 0) {
        logger.warn(`LiblibAI poll error: ${data.msg}`, { generateUuid });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const status = data.data?.generateStatus;

      if (status === 5) {
        // Success
        const imageUrl = data.data?.images?.[0]?.imageUrl;
        if (!imageUrl) {
          throw new Error(`LiblibAI generation succeeded but no imageUrl in response`);
        }
        logger.info(`LiblibAI generation complete`, { modelId, generateUuid });
        return { url: imageUrl };
      }

      if (status === 6) {
        throw new Error(`LiblibAI generation failed (status=6): ${data.data?.failedReason || "unknown"}`);
      }

      if (status === 7) {
        throw new Error(`LiblibAI generation timed out (status=7)`);
      }

      // Still processing, wait and retry
      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`LiblibAI polling timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
