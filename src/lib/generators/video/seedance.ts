/**
 * Seedance 2.0 (star-video2) Video Generator
 *
 * Uses reverse-engineered liblib.tv frontend API.
 * Auth: token + webid headers (not HMAC signature).
 * Supports: img2video (with imageList) and text2video fallback.
 */

import { randomUUID } from "crypto";
import type {
  VideoGenerator,
  VideoGenerateParams,
  GenerateResult,
  ProviderConfig,
} from "../types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "seedance-video" });

const API_BASE = "https://api.liblib.tv/api/task/generation";

// ─── Default credentials (reverse-engineered) ────────────────────────────
const DEFAULT_TOKEN = "f4cdb087b0f649b090ec906818a31e2b3852041c3c0a";
const DEFAULT_WEBID = "1742284320339icxfswzy";

// ─── Status codes from liblib.tv API ─────────────────────────────────────
// progressPercent 100 + taskResult = done
// status 4 or -1 = failed

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360; // ~30 minutes

function buildHeaders(token: string, webid: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://www.liblib.tv",
    referer: "https://www.liblib.tv/",
    token,
    webid,
    "x-language": "zh",
    "x-log-id": randomUUID(),
  };
}

export class SeedanceVideoGenerator implements VideoGenerator {
  private token: string;
  private webid: string;

  constructor(config: ProviderConfig) {
    // apiKey format: "token:webid" or use defaults
    if (config.apiKey && config.apiKey.includes(":")) {
      const [token, webid] = config.apiKey.split(":");
      this.token = token;
      this.webid = webid;
    } else {
      this.token = config.apiKey || DEFAULT_TOKEN;
      this.webid = DEFAULT_WEBID;
    }
  }

  async generate(params: VideoGenerateParams): Promise<GenerateResult> {
    const modeType = params.imageUrl ? "img2video" : "text2video";
    const imageList =
      modeType === "img2video" ? [{ url: params.imageUrl }] : [];

    const durationSec = params.durationMs
      ? Math.round(params.durationMs / 1000) > 7
        ? 10
        : 5
      : 10;

    const body = {
      params: {
        prompt: params.prompt || "",
        model: "star-video2",
        modeType,
        count: 1,
        ratio: "16:9",
        resolution: "1080p",
        duration: durationSec,
        enableSound: "on",
        search_enabled: 1,
        textList: [],
        imageList,
        videoList: [],
        audioList: [],
        infiniteSwitch: 0,
      },
      metadata: {
        node_id: randomUUID(),
        project_id: randomUUID().replace(/-/g, ""),
      },
      provider: "star-video2",
      model: "star-video2",
      taskType: "video",
      requestId: randomUUID(),
    };

    logger.info("Submitting Seedance task", { modeType, hasImage: !!params.imageUrl });

    // Step 1: Create task
    const taskId = await this.createTask(body);
    logger.info("Seedance task created", { taskId });

    // Step 2: Poll for result
    return this.pollResult(taskId);
  }

  private async createTask(body: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${API_BASE}/create`, {
      method: "POST",
      headers: buildHeaders(this.token, this.webid),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Seedance create failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Seedance create error: ${data.msg || JSON.stringify(data)}`);
    }

    const taskIds = data.data?.taskIds || data.data?.taskId;
    if (!taskIds) {
      throw new Error(`Seedance create returned no taskId: ${JSON.stringify(data)}`);
    }

    return Array.isArray(taskIds) ? taskIds[0] : taskIds;
  }

  private async pollResult(taskId: string): Promise<GenerateResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const response = await fetch(`${API_BASE}/progress`, {
        method: "POST",
        headers: buildHeaders(this.token, this.webid),
        body: JSON.stringify({ taskIds: [taskId] }),
      });

      if (!response.ok) {
        logger.warn(`Seedance poll failed (${response.status})`, { taskId });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = await response.json();
      if (data.code !== 0) {
        logger.warn(`Seedance poll error: ${data.msg}`, { taskId });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const progresses = data.data?.progresses || [];
      const task = progresses[0];
      if (!task) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const progress = task.progressPercent || 0;

      // Check for completed task
      if (task.taskResult && progress >= 100) {
        try {
          const result =
            typeof task.taskResult === "string"
              ? JSON.parse(task.taskResult)
              : task.taskResult;
          const videos = result.videos || [];
          const videoUrl = videos[0]?.previewPath || videos[0]?.url || videos[0]?.videoUrl;
          if (videoUrl) {
            logger.info("Seedance generation complete", { taskId });
            return { url: videoUrl, externalId: taskId };
          }
        } catch (e) {
          throw new Error(`Seedance result parse error: ${e}`);
        }
        throw new Error("Seedance completed but no video URL in result");
      }

      // Check for failure
      if (task.status === 4 || task.status === -1) {
        throw new Error(
          `Seedance generation failed: ${task.failReason || "unknown"}`,
        );
      }

      if (attempt % 6 === 0) {
        logger.info("Seedance polling...", { taskId, progress, attempt });
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `Seedance polling timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
