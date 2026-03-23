import { join } from "path";
import { prisma } from "@/lib/prisma";
import { extractFrames, cleanupFrames } from "@/lib/video-analyze/extract-frames";
import { analyzeFrames } from "@/lib/video-analyze/analyze";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "video-analyze" });

export const handleVideoAnalyze = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, projectId } = payload;

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  if (!project.sourceVideoUrl) {
    throw new Error("Project has no source video URL");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "analyzing" },
  });

  try {
    await ctx.reportProgress(10);

    // Step 1: Extract frames from video
    // Convert web URL path to local file path
    let videoPath = project.sourceVideoUrl;
    const storagePath = process.env.LOCAL_STORAGE_PATH || "./data";
    if (videoPath.startsWith("/api/files/")) {
      videoPath = join(storagePath, videoPath.replace(/^\/api\/files\//, ""));
    } else if (videoPath.startsWith("/data/")) {
      videoPath = videoPath.replace(/^\/data\//, `${storagePath}/`);
    }
    logger.info("Extracting frames", { projectId, videoPath });
    const { frames, tempDir, durationSec } = await extractFrames({
      videoPath,
      intervalSec: 5,
      maxFrames: 20,
    });

    await ctx.reportProgress(40);

    try {
      // Step 2: Analyze frames with multimodal LLM
      logger.info("Analyzing frames with LLM", { frameCount: frames.length });
      const language = "zh"; // Default to Chinese
      const analyzedText = await analyzeFrames(userId, frames, language);

      await ctx.reportProgress(80);

      // Step 3: Save analyzed text to project
      await prisma.project.update({
        where: { id: projectId },
        data: {
          analyzedText,
          status: "analyzed",
        },
      });

      logger.info("Video analysis complete", {
        projectId,
        durationSec,
        frameCount: frames.length,
        textLength: analyzedText.length,
      });

      return { projectId, durationSec, frameCount: frames.length, textLength: analyzedText.length };
    } finally {
      // Clean up temp frames
      await cleanupFrames(tempDir);
    }
  } catch (error) {
    // Restore project status on failure
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "draft" },
    }).catch(() => {});
    throw error;
  }
});
