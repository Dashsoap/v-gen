import OpenAI from "openai";
import type {
  AudioGenerator,
  AudioGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";

export class OpenAITTSGenerator implements AudioGenerator {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.defaultModel = config.model || "tts-1";
  }

  async generate(params: AudioGenerateParams): Promise<GenerateResult> {
    return withRetry(async () => {
      const response = await this.client.audio.speech.create({
        model: params.model || this.defaultModel,
        voice: (params.voiceId || "alloy") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
        input: params.text,
        speed: params.speed || 1.0,
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        base64: buffer.toString("base64"),
      };
    }, { label: `tts:${params.model || this.defaultModel}` });
  }
}
