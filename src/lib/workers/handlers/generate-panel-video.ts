import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createVideoGenerator } from "@/lib/generators/factory";
import { resolveVideoConfig, resolveProviderConfig, mapToVideoProvider } from "@/lib/providers/resolve";
import { buildVideoPromptWithReferences } from "@/lib/video/build-prompt";
import { createLLMClient, chatCompletion } from "@/lib/llm/client";
import { resolveLlmConfig } from "@/lib/providers/resolve";
import { TRANSITION_PROMPT_SYSTEM, TRANSITION_PROMPT_USER } from "@/lib/llm/prompts/transition-prompt";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "generate-panel-video" });

export const handleGeneratePanelVideo = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, data } = payload;
  const panelId = data.panelId as string;

  const panel = await prisma.panel.findUniqueOrThrow({
    where: { id: panelId },
    include: {
      clip: {
        include: {
          episode: { select: { projectId: true } },
        },
      },
    },
  });

  if (!panel.imageUrl) {
    throw new Error("Panel has no image — generate image first");
  }

  await ctx.reportProgress(10);

  const videoModelKey = data.videoModel as string | undefined;
  let provider: "openai" | "fal" | "google" | "liblib" | "seedance";
  let config;
  if (videoModelKey) {
    const resolved = await resolveProviderConfig(userId, "video", videoModelKey);
    provider = mapToVideoProvider(resolved.provider);
    config = resolved.config;
  } else {
    const resolved = await resolveVideoConfig(userId);
    provider = resolved.provider;
    config = resolved.config;
  }
  const generator = createVideoGenerator(provider, config);

  await ctx.reportProgress(30);

  // Find next panel for first-last-frame mode (always enabled)
  let lastFrameImageUrl: string | undefined;
  let nextPanelDescription: string | undefined;

  // 1. Try same clip, next sortOrder
  let nextPanel = await prisma.panel.findFirst({
    where: {
      clipId: panel.clipId,
      sortOrder: { gt: panel.sortOrder },
    },
    orderBy: { sortOrder: "asc" },
    select: { imageUrl: true, sceneDescription: true },
  });

  // 2. If no next panel in same clip, try next clip in same episode
  if (!nextPanel?.imageUrl) {
    const clip = await prisma.clip.findUnique({
      where: { id: panel.clipId },
      select: { episodeId: true, sortOrder: true },
    });
    if (clip) {
      const nextClip = await prisma.clip.findFirst({
        where: {
          episodeId: clip.episodeId,
          sortOrder: { gt: clip.sortOrder },
        },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      if (nextClip) {
        nextPanel = await prisma.panel.findFirst({
          where: { clipId: nextClip.id },
          orderBy: { sortOrder: "asc" },
          select: { imageUrl: true, sceneDescription: true },
        });
      }
    }
  }

  if (nextPanel?.imageUrl) {
    lastFrameImageUrl = nextPanel.imageUrl;
    nextPanelDescription = nextPanel.sceneDescription || undefined;
    logger.info("Using first-last-frame mode", { panelId });
  }

  // Build video prompt
  let enhancedPrompt: string;
  const startDesc = panel.sceneDescription || panel.videoPrompt || panel.imagePrompt || "";

  if (lastFrameImageUrl && nextPanelDescription && startDesc) {
    // Use LLM to generate transition prompt between frames
    try {
      const llmConfig = await resolveLlmConfig(userId);
      const llmClient = createLLMClient(llmConfig);
      enhancedPrompt = await chatCompletion(llmClient, {
        model: llmConfig.model,
        systemPrompt: TRANSITION_PROMPT_SYSTEM,
        userPrompt: TRANSITION_PROMPT_USER(startDesc, nextPanelDescription),
        temperature: 0.8,
      });
      // Trim to 490 chars (API limit)
      if (enhancedPrompt.length > 490) {
        enhancedPrompt = enhancedPrompt.substring(0, 490);
      }
      logger.info("Generated transition prompt via LLM", { panelId, promptLength: enhancedPrompt.length });
    } catch (err) {
      logger.warn("LLM transition prompt failed, falling back", { panelId, error: String(err) });
      enhancedPrompt = buildVideoPromptWithReferences(panel.imageUrl, startDesc, panel);
    }
  } else {
    // No next frame or missing descriptions — use standard prompt
    enhancedPrompt = buildVideoPromptWithReferences(panel.imageUrl, startDesc, panel);
  }

  // Ensure prompt is never empty — Kling API rejects empty prompts
  if (!enhancedPrompt || enhancedPrompt.trim().length === 0) {
    enhancedPrompt = startDesc || "A cinematic scene with smooth camera movement.";
  }

  logger.info("Built video prompt", { panelId, promptLength: enhancedPrompt.length, hasEndFrame: !!lastFrameImageUrl });

  await ctx.reportProgress(50);

  // Convert base64 data URIs to files, then to public URLs
  const storagePath = process.env.LOCAL_STORAGE_PATH || "./data";
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  async function resolveImageUrl(url: string): Promise<string> {
    if (url.startsWith("data:image/")) {
      // Save base64 to file
      const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) return url;
      let ext = match[1] === "jpeg" ? "jpg" : match[1];
      const b64 = match[2];
      if (b64.startsWith("/9j/")) ext = "jpg";
      const dir = join(storagePath, "images", "converted");
      await mkdir(dir, { recursive: true });
      const filename = `${randomUUID()}.${ext}`;
      await writeFile(join(dir, filename), Buffer.from(b64, "base64"));
      const newUrl = `/api/files/images/converted/${filename}`;
      // Update panel imageUrl in DB
      await prisma.panel.update({ where: { id: panelId }, data: { imageUrl: newUrl } });
      return `${baseUrl}${newUrl}`;
    }
    if (url.startsWith("/api/files/") || url.startsWith("/data/")) {
      return `${baseUrl}${url}`;
    }
    return url;
  }

  let imageUrl = await resolveImageUrl(panel.imageUrl);
  if (lastFrameImageUrl) {
    lastFrameImageUrl = await resolveImageUrl(lastFrameImageUrl);
  }

  const result = await generator.generate({
    imageUrl,
    prompt: enhancedPrompt,
    durationMs: panel.durationMs,
    lastFrameImageUrl,
  });

  const videoUrl = result.url;
  if (videoUrl) {
    await prisma.panel.update({
      where: { id: panelId },
      data: { videoUrl },
    });
  }

  return { panelId, videoUrl, externalId: result.externalId };
});
