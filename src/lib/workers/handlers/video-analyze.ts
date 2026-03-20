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

  await ctx.reportProgress(10);

  // Step 1: Extract frames from video
  logger.info("Extracting frames", { projectId, videoUrl: project.sourceVideoUrl });
  const { frames, tempDir, durationSec } = await extractFrames({
    videoPath: project.sourceVideoUrl,
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
});
