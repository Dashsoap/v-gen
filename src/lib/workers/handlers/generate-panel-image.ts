import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createLLMClient, chatCompletion } from "@/lib/llm/client";
import {
  GENERATE_IMAGE_PROMPT_SYSTEM,
  GENERATE_IMAGE_PROMPT_USER,
  buildImagePromptFromContext,
} from "@/lib/llm/prompts/generate-image-prompt";
import { detectLanguage } from "@/lib/llm/language-detect";
import { createImageGenerator } from "@/lib/generators/factory";
import { resolveImageConfig, resolveProviderConfig, mapToImageProvider, resolveLlmConfig } from "@/lib/providers/resolve";
import type { ImageProviderType } from "@/lib/generators/types";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "generate-panel-image" });

export const handleGeneratePanelImage = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, projectId, data } = payload;
  const panelId = data.panelId as string;
  const candidateCount = (data.candidateCount as number) || 1;
  const imageModel = data.imageModel as string | undefined;

  const panel = await prisma.panel.findUniqueOrThrow({
    where: { id: panelId },
    include: {
      clip: {
        include: {
          episode: { include: { project: true } },
        },
      },
    },
  });

  const project = panel.clip.episode.project;

  // Detect language
  const sampleText = panel.sourceText || panel.sceneDescription || project.analyzedText || "";
  const language = detectLanguage(sampleText);

  // Step 1: Generate or assemble image prompt
  await ctx.reportProgress(20);

  let imagePrompt: string;

  // Try structured prompt from Stage 3 data first
  const structuredPrompt = buildImagePromptFromContext(
    {
      sceneDescription: panel.sceneDescription || "",
      cameraAngle: panel.cameraAngle || undefined,
      shotType: panel.shotType || undefined,
      cameraMove: panel.cameraMove || undefined,
      photographyRules: panel.photographyRules || undefined,
      actingNotes: panel.actingNotes || undefined,
      videoPrompt: panel.videoPrompt || undefined,
      sceneType: panel.sceneType || undefined,
    },
    [], // No characters in v-gen
    [], // No locations in v-gen
    project.style,
    language,
  );

  if (structuredPrompt) {
    imagePrompt = structuredPrompt;
    logger.info("Using structured image prompt from Stage 3 data", { panelId });
  } else {
    // Fallback: LLM-based prompt generation
    logger.info("Falling back to LLM image prompt generation", { panelId });
    const llmCfg = await resolveLlmConfig(userId);
    const client = createLLMClient(llmCfg);

    imagePrompt = await chatCompletion(client, {
      model: llmCfg.model,
      systemPrompt: GENERATE_IMAGE_PROMPT_SYSTEM(language),
      userPrompt: GENERATE_IMAGE_PROMPT_USER(
        panel.sceneDescription || "",
        panel.cameraAngle || "medium",
        project.style,
        "",
      ),
    });
  }

  await prisma.panel.update({
    where: { id: panelId },
    data: { imagePrompt },
  });

  // Step 2: Generate image(s)
  await ctx.reportProgress(40);
  let provider: ImageProviderType;
  let config;
  if (imageModel) {
    const resolved = await resolveProviderConfig(userId, "image", imageModel);
    provider = mapToImageProvider(resolved.provider);
    config = resolved.config;
  } else {
    const resolved = await resolveImageConfig(userId);
    provider = resolved.provider;
    config = resolved.config;
  }
  const generator = createImageGenerator(provider, config);

  const aspectRatio = project.aspectRatio || "16:9";
  const [w, h] = aspectRatio.split(":").map(Number);
  const baseSize = 1024;
  const width = w > h ? Math.round(baseSize * (w / h)) : baseSize;
  const height = h > w ? Math.round(baseSize * (h / w)) : baseSize;

  const generateParams = {
    prompt: imagePrompt,
    width,
    height,
    style: project.style,
  };

  // Generate N candidate images in parallel
  const generatePromises = Array.from({ length: candidateCount }, () =>
    generator.generate(generateParams),
  );

  const results = await Promise.all(generatePromises);

  const candidateUrls: string[] = [];
  const storagePath = process.env.LOCAL_STORAGE_PATH || "./data";
  const imageDir = join(storagePath, "images", projectId || "unknown");
  await mkdir(imageDir, { recursive: true });

  for (const result of results) {
    if (result.url && !result.url.startsWith("data:")) {
      candidateUrls.push(result.url);
    } else if (result.base64 || (result.url && result.url.startsWith("data:"))) {
      // Save base64 to file and return accessible URL
      let base64Data = result.base64 || "";
      let ext = "png";
      if (!base64Data && result.url) {
        const match = result.url.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          ext = match[1] === "jpeg" ? "jpg" : match[1];
          base64Data = match[2];
        }
      }
      // Detect actual format from magic bytes
      if (base64Data.startsWith("/9j/")) ext = "jpg";
      else if (base64Data.startsWith("iVBOR")) ext = "png";

      const filename = `${randomUUID()}.${ext}`;
      const filepath = join(imageDir, filename);
      await writeFile(filepath, Buffer.from(base64Data, "base64"));
      candidateUrls.push(`/api/files/images/${projectId || "unknown"}/${filename}`);
    }
  }

  if (candidateUrls.length === 0) {
    logger.error("All image generation attempts returned empty results", { panelId, provider, model: config.model });
    throw new Error(`Image generation returned no results (provider: ${provider}, model: ${config.model})`);
  }

  // Save results
  const imageUrl = candidateUrls[0];
  const updateData: Record<string, unknown> = { imageUrl };

  if (candidateUrls.length > 1) {
    updateData.candidateImages = JSON.stringify(candidateUrls);
    updateData.selectedImageIndex = 0;
  }

  await prisma.panel.update({
    where: { id: panelId },
    data: updateData,
  });

  logger.info("Image saved", { panelId, provider, model: config.model, candidateCount: candidateUrls.length });
  return { panelId, imageUrl, candidateCount: candidateUrls.length };
});
