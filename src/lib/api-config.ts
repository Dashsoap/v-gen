/**
 * API 配置中心
 *
 * 管理用户的自定义供应商和模型配置。
 * Provider 支持：预设供应商 + 无限 OpenAI 兼容端点（NewAPI/OneAPI 等）
 * Model Key 格式：provider::modelId
 */

import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import {
  PRESET_PROVIDERS as _PRESET_PROVIDERS,
  PRESET_MODELS as _PRESET_MODELS,
  type PresetModel,
  type PresetProvider,
} from "./preset-models";

// Re-export preset data and types
export { _PRESET_PROVIDERS as PRESET_PROVIDERS, _PRESET_MODELS as PRESET_MODELS };
export type { PresetModel, PresetProvider };

// ─── Types ────────────────────────────────────────────────────────────────

export type ModelMediaType = "llm" | "image" | "video" | "audio";

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl?: string;
  apiKey?: string; // encrypted in DB
}

export interface CustomModel {
  modelId: string;
  modelKey: string; // provider::modelId
  name: string;
  type: ModelMediaType;
  provider: string;
  enabled: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string; // decrypted
  baseUrl?: string;
}

export interface ModelSelection {
  provider: string;
  modelId: string;
  modelKey: string;
  mediaType: ModelMediaType;
}

// ─── Model Key Helpers ────────────────────────────────────────────────────

const MODEL_KEY_SEPARATOR = "::";

export function composeModelKey(provider: string, modelId: string): string {
  if (!provider || !modelId) return "";
  return `${provider}${MODEL_KEY_SEPARATOR}${modelId}`;
}

export function parseModelKey(modelKey: string): { provider: string; modelId: string } | null {
  const idx = modelKey.indexOf(MODEL_KEY_SEPARATOR);
  if (idx === -1) return null;
  const provider = modelKey.slice(0, idx);
  const modelId = modelKey.slice(idx + MODEL_KEY_SEPARATOR.length);
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

/**
 * Extract provider base key (for multi-instance: openai-compatible:uuid → openai-compatible)
 */
export function getProviderKey(providerId: string): string {
  const colonIndex = providerId.indexOf(":");
  return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex);
}

// ─── Base URL Normalization ───────────────────────────────────────────────

function normalizeBaseUrl(providerId: string, rawBaseUrl?: string): string | undefined {
  let baseUrl = rawBaseUrl?.trim();
  if (!baseUrl) return undefined;

  // Auto-add https:// if no protocol
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }

  const key = getProviderKey(providerId);
  if (key !== "openai-compatible") return baseUrl;

  // Auto-append /v1 for OpenAI-compatible endpoints
  try {
    const parsed = new URL(baseUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.includes("v1")) return baseUrl;
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${trimmed || ""}/v1`;
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

// ─── Parsing ──────────────────────────────────────────────────────────────

function parseCustomProviders(raw: string | null | undefined): CustomProvider[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p: Record<string, unknown>) => p && typeof p === "object" && p.id && p.name)
      .map((p: Record<string, unknown>) => ({
        id: String(p.id),
        name: String(p.name),
        baseUrl: p.baseUrl ? String(p.baseUrl) : undefined,
        apiKey: p.apiKey ? String(p.apiKey) : undefined,
      }));
  } catch {
    return [];
  }
}

function parseCustomModels(raw: string | null | undefined): CustomModel[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m: Record<string, unknown>) => m && typeof m === "object" && m.provider && m.modelId)
      .map((m: Record<string, unknown>) => {
        const provider = String(m.provider);
        const modelId = String(m.modelId);
        return {
          modelId,
          modelKey: composeModelKey(provider, modelId),
          name: m.name ? String(m.name) : modelId,
          type: (m.type as ModelMediaType) || "llm",
          provider,
          enabled: m.enabled !== false,
        };
      });
  } catch {
    return [];
  }
}

// ─── Core Config Reader ───────────────────────────────────────────────────

async function readUserConfig(userId: string) {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customProviders: true,
      customModels: true,
      defaultLlmModel: true,
      defaultImageModel: true,
      defaultVideoModel: true,
      defaultAudioModel: true,
      ttsVoice: true,
    },
  });

  return {
    providers: parseCustomProviders(pref?.customProviders),
    models: parseCustomModels(pref?.customModels),
    defaults: {
      llm: pref?.defaultLlmModel ?? null,
      image: pref?.defaultImageModel ?? null,
      video: pref?.defaultVideoModel ?? null,
      audio: pref?.defaultAudioModel ?? null,
    },
    ttsVoice: pref?.ttsVoice ?? "alloy",
  };
}

// ─── Provider Config ──────────────────────────────────────────────────────

export async function getProviderConfig(userId: string, providerId: string): Promise<ProviderConfig> {
  const { providers } = await readUserConfig(userId);
  const provider = providers.find((p) => p.id === providerId);

  if (!provider) {
    throw new Error(`PROVIDER_NOT_FOUND: ${providerId} is not configured`);
  }
  if (!provider.apiKey) {
    throw new Error(`PROVIDER_API_KEY_MISSING: ${providerId}`);
  }

  return {
    id: provider.id,
    name: provider.name,
    apiKey: decrypt(provider.apiKey),
    baseUrl: normalizeBaseUrl(provider.id, provider.baseUrl),
  };
}

// ─── Model Resolution ─────────────────────────────────────────────────────

export async function getModelsByType(userId: string, type: ModelMediaType): Promise<CustomModel[]> {
  const { models } = await readUserConfig(userId);
  return models.filter((m) => m.type === type && m.enabled);
}

export async function resolveModelSelection(
  userId: string,
  modelKey: string,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const parsed = parseModelKey(modelKey);
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${modelKey} must be provider::modelId`);
  }

  const models = await getModelsByType(userId, mediaType);
  const match = models.find((m) => m.provider === parsed.provider && m.modelId === parsed.modelId);
  if (!match) {
    throw new Error(`MODEL_NOT_FOUND: ${modelKey} is not enabled for ${mediaType}`);
  }

  return {
    provider: match.provider,
    modelId: match.modelId,
    modelKey: match.modelKey,
    mediaType,
  };
}

/**
 * Resolve default model for a media type.
 * If user has a default set, use that. Otherwise pick the first enabled model.
 */
export async function resolveDefaultModel(
  userId: string,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const config = await readUserConfig(userId);

  // Check user default key first — works even without customModels list
  const defaultKey = config.defaults[mediaType];
  if (defaultKey) {
    const parsed = parseModelKey(defaultKey);
    if (parsed) {
      return {
        provider: parsed.provider,
        modelId: parsed.modelId,
        modelKey: defaultKey,
        mediaType,
      };
    }
  }

  // Fallback to first enabled model in customModels list
  const models = config.models.filter((m) => m.type === mediaType && m.enabled);
  if (models.length > 0) {
    const first = models[0];
    return {
      provider: first.provider,
      modelId: first.modelId,
      modelKey: first.modelKey,
      mediaType,
    };
  }

  throw new Error(`MODEL_NOT_CONFIGURED: no ${mediaType} model is enabled`);
}

/**
 * Get TTS voice preference
 */
export async function getTtsVoice(userId: string): Promise<string> {
  const config = await readUserConfig(userId);
  return config.ttsVoice;
}

/**
 * Check if user has any API configuration
 */
export async function hasApiConfig(userId: string): Promise<boolean> {
  const { providers } = await readUserConfig(userId);
  return providers.some((p) => !!p.apiKey);
}
