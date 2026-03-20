import * as fs from "fs";
import { createLLMClient, chatCompletion } from "@/lib/llm/client";
import { resolveLlmConfig } from "@/lib/providers/resolve";
import { createScopedLogger } from "@/lib/logging";
import type { ExtractedFrame } from "./extract-frames";

const logger = createScopedLogger({ module: "video-analyze" });

const ANALYZE_SYSTEM_PROMPT = `你是一位专业的视频内容分析师。你将看到从视频中提取的多个关键帧截图。

请分析这些帧，按时间顺序描述视频内容，生成一份完整的场景描述文案。

要求：
1. 按时间顺序描述每个场景发生的事情
2. 描述人物的外貌、动作、表情
3. 描述环境、场景、光线、氛围
4. 如果有字幕或文字，请记录下来
5. 标注场景转换点
6. 使用生动、具体的语言，适合后续改写为分镜脚本
7. 输出为连贯的文字描述，不要用列表格式

输出格式：直接输出连贯的场景描述文字，用段落分隔不同场景。`;

const ANALYZE_SYSTEM_PROMPT_EN = `You are a professional video content analyst. You will see multiple keyframes extracted from a video.

Analyze these frames and describe the video content in chronological order, generating a complete scene description.

Requirements:
1. Describe each scene chronologically
2. Describe characters' appearance, actions, expressions
3. Describe environment, setting, lighting, atmosphere
4. Note any subtitles or text visible in frames
5. Mark scene transition points
6. Use vivid, specific language suitable for later storyboard adaptation
7. Output as flowing paragraphs, not bullet lists

Output format: Write continuous scene descriptions, separated into paragraphs for different scenes.`;

/**
 * Analyze extracted video frames using a multimodal LLM.
 * Sends frames as images and gets back a scene description.
 */
export async function analyzeFrames(
  userId: string,
  frames: ExtractedFrame[],
  language: "zh" | "en" = "zh",
): Promise<string> {
  const llmCfg = await resolveLlmConfig(userId);
  const client = createLLMClient(llmCfg);

  // Build multimodal content with frame images
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];

  content.push({
    type: "text",
    text: `以下是从视频中每隔几秒提取的${frames.length}个关键帧，请分析视频内容：`,
  });

  // Add frames as base64 images
  for (const frame of frames) {
    const imageData = await fs.promises.readFile(frame.path);
    const base64 = imageData.toString("base64");
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${base64}`,
      },
    });
    content.push({
      type: "text",
      text: `[${formatTimestamp(frame.timestampSec)}]`,
    });
  }

  logger.info("Sending frames to LLM for analysis", {
    frameCount: frames.length,
    model: llmCfg.model,
  });

  // Use chatCompletion with multimodal content
  const result = await chatCompletion(client, {
    model: llmCfg.model,
    systemPrompt: language === "zh" ? ANALYZE_SYSTEM_PROMPT : ANALYZE_SYSTEM_PROMPT_EN,
    userPrompt: content,
  });

  logger.info("Video analysis complete", { resultLength: result.length });
  return result;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
