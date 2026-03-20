import type {
  AudioGenerator,
  AudioGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { withRetry } from "@/lib/retry";

export class FishAudioGenerator implements AudioGenerator {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.fish.audio";
  }

  async generate(params: AudioGenerateParams): Promise<GenerateResult> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: params.text,
          reference_id: params.voiceId,
          format: "mp3",
          mp3_bitrate: 128,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        const error = await response.text();
        const err = new Error(`Fish Audio TTS failed (${status}): ${error}`);
        (err as unknown as Record<string, unknown>).status = status;
        throw err;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        base64: buffer.toString("base64"),
      };
    }, { label: "fish-audio-tts" });
  }
}
