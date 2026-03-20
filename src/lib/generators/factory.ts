import type {
  ImageGenerator,
  VideoGenerator,
  AudioGenerator,
  ProviderConfig,
  ImageProviderType,
  VideoProviderType,
  AudioProviderType,
} from "./types";

import { OpenAIImageGenerator } from "./image/openai-compatible";
import { FalImageGenerator } from "./image/fal";
import { GeminiImageGenerator } from "./image/google-gemini";
import { LiblibImageGenerator } from "./image/liblib";
import { OpenAIVideoGenerator } from "./video/openai-compatible";
import { FalVideoGenerator } from "./video/fal";
import { GoogleVeoGenerator } from "./video/google-veo";
import { LiblibVideoGenerator } from "./video/liblib";
import { OpenAITTSGenerator } from "./audio/openai-tts";
import { FishAudioGenerator } from "./audio/fish-audio";
import { ElevenLabsGenerator } from "./audio/elevenlabs";

export function createImageGenerator(
  provider: ImageProviderType,
  config: ProviderConfig
): ImageGenerator {
  switch (provider) {
    case "openai":
      return new OpenAIImageGenerator(config);
    case "fal":
      return new FalImageGenerator(config);
    case "google-gemini":
      return new GeminiImageGenerator(config);
    case "liblib":
      return new LiblibImageGenerator(config);
    default:
      throw new Error(`Unknown image provider: ${provider}`);
  }
}

export function createVideoGenerator(
  provider: VideoProviderType,
  config: ProviderConfig
): VideoGenerator {
  switch (provider) {
    case "openai":
      return new OpenAIVideoGenerator(config);
    case "fal":
      return new FalVideoGenerator(config);
    case "google":
      return new GoogleVeoGenerator(config);
    case "liblib":
      return new LiblibVideoGenerator(config);
    default:
      throw new Error(`Unknown video provider: ${provider}`);
  }
}

export function createAudioGenerator(
  provider: AudioProviderType,
  config: ProviderConfig
): AudioGenerator {
  switch (provider) {
    case "openai":
      return new OpenAITTSGenerator(config);
    case "fish-audio":
      return new FishAudioGenerator(config);
    case "elevenlabs":
      return new ElevenLabsGenerator(config);
    default:
      throw new Error(`Unknown audio provider: ${provider}`);
  }
}
