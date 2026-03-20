export interface GenerateResult {
  url?: string;
  base64?: string;
  externalId?: string;
}

export interface ImageGenerateParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
  model?: string;
}

export interface ImageGenerator {
  generate(params: ImageGenerateParams): Promise<GenerateResult>;
}

export interface VideoReferenceImage {
  url: string;
  type: "character" | "location" | "keyframe";
  name: string;
}

export interface VideoGenerateParams {
  imageUrl: string;
  prompt?: string;
  durationMs?: number;
  model?: string;
  lastFrameImageUrl?: string;
  referenceImages?: VideoReferenceImage[];
}

export interface VideoGenerator {
  generate(params: VideoGenerateParams): Promise<GenerateResult>;
}

export interface AudioGenerateParams {
  text: string;
  voiceId?: string;
  model?: string;
  speed?: number;
}

export interface AudioGenerator {
  generate(params: AudioGenerateParams): Promise<GenerateResult>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export type ImageProviderType = "openai" | "fal" | "google-gemini" | "liblib";
export type VideoProviderType = "openai" | "fal" | "google" | "liblib";
export type AudioProviderType = "openai" | "fish-audio" | "elevenlabs";
