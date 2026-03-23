import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createAudioGenerator } from "@/lib/generators/factory";
import { resolveAudioConfig } from "@/lib/providers/resolve";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "generate-voice-line" });

export const handleGenerateVoiceLine = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, projectId, data } = payload;
  const panelId = data.panelId as string;

  // Load voice lines for this panel
  const voiceLines = await prisma.voiceLine.findMany({
    where: { panelId },
    orderBy: { startMs: "asc" },
  });

  if (voiceLines.length === 0) {
    logger.info("No voice lines for panel", { panelId });
    return { panelId, generated: 0 };
  }

  await ctx.reportProgress(10);

  // Resolve audio config
  const { provider, config, voiceId } = await resolveAudioConfig(userId);
  const generator = createAudioGenerator(provider, config);

  const storagePath = process.env.LOCAL_STORAGE_PATH || "./data";
  const audioDir = join(storagePath, "audio", projectId || "unknown");
  await mkdir(audioDir, { recursive: true });

  let generated = 0;
  const total = voiceLines.length;

  for (let i = 0; i < voiceLines.length; i++) {
    const vl = voiceLines[i];

    // Skip if already has audio
    if (vl.audioUrl) {
      generated++;
      continue;
    }

    try {
      const result = await generator.generate({
        text: vl.text,
        voiceId,
      });

      // Save audio to file
      let audioUrl: string;
      if (result.base64) {
        const filename = `${randomUUID()}.mp3`;
        const filepath = join(audioDir, filename);
        await writeFile(filepath, Buffer.from(result.base64, "base64"));
        audioUrl = `/api/files/audio/${projectId || "unknown"}/${filename}`;
      } else if (result.url) {
        audioUrl = result.url;
      } else {
        logger.warn("TTS returned no audio", { voiceLineId: vl.id });
        continue;
      }

      await prisma.voiceLine.update({
        where: { id: vl.id },
        data: { audioUrl },
      });

      generated++;
      logger.info("Voice line generated", { voiceLineId: vl.id, speaker: vl.speaker });
    } catch (err) {
      logger.error("Failed to generate voice line", {
        voiceLineId: vl.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await ctx.reportProgress(10 + Math.round((i / total) * 80));
  }

  logger.info("Voice lines complete", { panelId, generated, total });
  return { panelId, generated, total };
});
