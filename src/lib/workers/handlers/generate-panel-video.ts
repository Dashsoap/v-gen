import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createVideoGenerator } from "@/lib/generators/factory";
import { resolveVideoConfig, resolveProviderConfig, mapToVideoProvider } from "@/lib/providers/resolve";
import { buildVideoPromptWithReferences } from "@/lib/video/build-prompt";
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
  let provider: "openai" | "fal" | "google" | "liblib";
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

  // Build enhanced prompt
  const basePrompt = panel.videoPrompt || panel.sceneDescription || "";
  const enhancedPrompt = buildVideoPromptWithReferences(
    panel.imageUrl,
    basePrompt,
    panel,
  );

  logger.info("Built video prompt", { panelId, promptLength: enhancedPrompt.length });

  // Check for first-last-frame mode
  let lastFrameImageUrl: string | undefined;
  if (panel.videoGenerationMode === "firstlastframe") {
    const nextPanel = await prisma.panel.findFirst({
      where: {
        clipId: panel.clipId,
        sortOrder: { gt: panel.sortOrder },
      },
      orderBy: { sortOrder: "asc" },
      select: { imageUrl: true },
    });

    if (nextPanel?.imageUrl) {
      lastFrameImageUrl = nextPanel.imageUrl;
      logger.info("Using first-last-frame mode", { panelId });
    }
  }

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
