/**
 * Provider resolution using the new api-config system.
 * Resolves user's configured providers/models into generator configs.
 */

import {
  getProviderConfig,
  resolveDefaultModel,
  getProviderKey,
  getTtsVoice,
  type ModelMediaType,
} from "@/lib/api-config";
import type { ProviderConfig } from "@/lib/generators/types";

/**
 * Resolve image generation config from user preferences.
 */
export async function resolveImageConfig(userId: string) {
  const selection = await resolveDefaultModel(userId, "image");
  const providerConfig = await getProviderConfig(userId, selection.provider);

  return {
    provider: mapToImageProvider(selection.provider),
    config: {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model: selection.modelId,
    } as ProviderConfig,
  };
}

/**
 * Resolve video generation config from user preferences.
 */
export async function resolveVideoConfig(userId: string) {
  const selection = await resolveDefaultModel(userId, "video");
  const providerConfig = await getProviderConfig(userId, selection.provider);

  return {
    provider: mapToVideoProvider(selection.provider),
    config: {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model: selection.modelId,
    } as ProviderConfig,
  };
}

/**
 * Resolve audio/TTS config from user preferences.
 */
export async function resolveAudioConfig(userId: string) {
  const selection = await resolveDefaultModel(userId, "audio");
  const providerConfig = await getProviderConfig(userId, selection.provider);
  const voiceId = await getTtsVoice(userId);

  return {
    provider: mapToAudioProvider(selection.provider),
    config: {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model: selection.modelId,
    } as ProviderConfig,
    voiceId,
  };
}

/**
 * Resolve LLM config from user preferences.
 */
export async function resolveLlmConfig(userId: string) {
  const selection = await resolveDefaultModel(userId, "llm");
  const providerConfig = await getProviderConfig(userId, selection.provider);

  return {
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model: selection.modelId,
  };
}

/**
 * Resolve provider config for a specific media type and model key.
 */
export async function resolveProviderConfig(
  userId: string,
  mediaType: ModelMediaType,
  modelKey?: string,
) {
  if (modelKey) {
    // Direct model key resolution
    const { resolveModelSelection } = await import("@/lib/api-config");
    const selection = await resolveModelSelection(userId, modelKey, mediaType);
    const providerConfig = await getProviderConfig(userId, selection.provider);
    return {
      provider: selection.provider,
      config: {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        model: selection.modelId,
      } as ProviderConfig,
    };
  }

  // Default model resolution
  const selection = await resolveDefaultModel(userId, mediaType);
  const providerConfig = await getProviderConfig(userId, selection.provider);
  return {
    provider: selection.provider,
    config: {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model: selection.modelId,
    } as ProviderConfig,
  };
}

// ─── Provider Type Mapping ────────────────────────────────────────────────
// Maps config provider IDs to the generator factory type strings

export function mapToImageProvider(providerId: string): "openai" | "fal" | "google-gemini" | "liblib" {
  const key = getProviderKey(providerId);
  if (key === "fal") return "fal";
  if (key === "google") return "google-gemini";
  if (key === "liblib") return "liblib";
  return "openai"; // openai-compatible and others
}

export function mapToVideoProvider(providerId: string): "openai" | "fal" | "google" | "liblib" {
  const key = getProviderKey(providerId);
  if (key === "fal") return "fal";
  if (key === "google") return "google";
  if (key === "liblib") return "liblib";
  return "openai";
}

function mapToAudioProvider(providerId: string): "openai" | "fish-audio" | "elevenlabs" {
  const key = getProviderKey(providerId);
  if (key === "fish-audio") return "fish-audio";
  if (key === "elevenlabs") return "elevenlabs";
  return "openai";
}
