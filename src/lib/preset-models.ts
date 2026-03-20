/**
 * Shared preset model and provider definitions.
 * Single source of truth for both server (api-config.ts) and client (hooks.ts).
 */

export type ModelMediaType = "llm" | "image" | "video" | "audio";

export interface PresetProvider {
  id: string;
  name: string;
  needsBaseUrl?: boolean;
}

export interface PresetModel {
  modelId: string;
  name: string;
  type: ModelMediaType;
  provider: string;
}

export const PRESET_PROVIDERS: PresetProvider[] = [
  { id: "openai-compatible", name: "OpenAI Compatible", needsBaseUrl: true },
  { id: "fal", name: "FAL" },
  { id: "google", name: "Google AI Studio" },
  { id: "fish-audio", name: "Fish Audio" },
  { id: "elevenlabs", name: "ElevenLabs" },
  { id: "liblib", name: "LiblibAI" },
];

export const PRESET_MODELS: PresetModel[] = [
  // OpenAI Compatible - LLM
  { modelId: "gpt-4o", name: "GPT-4o", type: "llm", provider: "openai-compatible" },
  { modelId: "gpt-4o-mini", name: "GPT-4o Mini", type: "llm", provider: "openai-compatible" },
  { modelId: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", type: "llm", provider: "openai-compatible" },
  { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash", type: "llm", provider: "openai-compatible" },
  { modelId: "deepseek-chat", name: "DeepSeek V3", type: "llm", provider: "openai-compatible" },

  // OpenAI Compatible - Image
  { modelId: "gpt-image-1", name: "GPT Image 1", type: "image", provider: "openai-compatible" },
  { modelId: "dall-e-3", name: "DALL-E 3", type: "image", provider: "openai-compatible" },

  // OpenAI Compatible - Video
  { modelId: "sora", name: "Sora", type: "video", provider: "openai-compatible" },

  // OpenAI Compatible - Audio
  { modelId: "tts-1", name: "TTS-1", type: "audio", provider: "openai-compatible" },
  { modelId: "tts-1-hd", name: "TTS-1 HD", type: "audio", provider: "openai-compatible" },

  // FAL - Image
  { modelId: "fal-ai/flux-pro/v1.1", name: "Flux Pro v1.1", type: "image", provider: "fal" },
  { modelId: "fal-ai/flux/dev", name: "Flux Dev", type: "image", provider: "fal" },

  // FAL - Video
  { modelId: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", name: "Kling 2.5 Turbo Pro", type: "video", provider: "fal" },
  { modelId: "fal-ai/kling-video/v3/pro/image-to-video", name: "Kling 3 Pro", type: "video", provider: "fal" },
  { modelId: "fal-ai/runway-gen3/turbo/image-to-video", name: "Runway Gen3 Turbo", type: "video", provider: "fal" },

  // FAL - Audio
  { modelId: "fal-ai/index-tts-2/text-to-speech", name: "IndexTTS 2", type: "audio", provider: "fal" },

  // Google - Image
  { modelId: "gemini-2.0-flash-preview-image-generation", name: "Gemini Image Gen", type: "image", provider: "google" },
  { modelId: "imagen-4.0-generate-001", name: "Imagen 4", type: "image", provider: "google" },
  { modelId: "imagen-4.0-fast-generate-001", name: "Imagen 4 Fast", type: "image", provider: "google" },

  // Google - Video
  { modelId: "veo-3.0-generate-001", name: "Veo 3.0", type: "video", provider: "google" },
  { modelId: "veo-2.0-generate-001", name: "Veo 2.0", type: "video", provider: "google" },

  // Fish Audio
  { modelId: "default", name: "Fish Audio Default", type: "audio", provider: "fish-audio" },

  // ElevenLabs
  { modelId: "eleven_multilingual_v2", name: "Multilingual v2", type: "audio", provider: "elevenlabs" },

  // LiblibAI - Image
  { modelId: "kontext-pro", name: "F.1 Kontext Pro", type: "image", provider: "liblib" },
  { modelId: "kontext-max", name: "F.1 Kontext Max", type: "image", provider: "liblib" },
  { modelId: "star3-alpha", name: "Star-3 Alpha", type: "image", provider: "liblib" },
  { modelId: "libdream", name: "LibDream", type: "image", provider: "liblib" },
  { modelId: "seedream-4", name: "Seedream 4.0", type: "image", provider: "liblib" },

  // LiblibAI - Video (Kling via LiblibAI)
  { modelId: "kling-v2-1", name: "Kling 2.1", type: "video", provider: "liblib" },
  { modelId: "kling-v2-5-turbo", name: "Kling 2.5 Turbo", type: "video", provider: "liblib" },
  { modelId: "kling-v2-6", name: "Kling 2.6", type: "video", provider: "liblib" },
  { modelId: "kling-v2-master", name: "Kling 2.0 Master", type: "video", provider: "liblib" },
];
