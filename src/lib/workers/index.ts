import { Worker } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { createScopedLogger } from "@/lib/logging";
import { prisma } from "@/lib/prisma";
import { QUEUE_NAMES, TaskType } from "@/lib/task/types";
import type { TaskPayload } from "@/lib/task/types";

import { handleVideoAnalyze } from "./handlers/video-analyze";
import { handleRewrite } from "./handlers/rewrite";
import { handleGenerateStoryboard } from "./handlers/generate-storyboard";
import { handleGeneratePanelImage } from "./handlers/generate-panel-image";
import { handleGeneratePanelVideo } from "./handlers/generate-panel-video";
import { handleComposeVideo } from "./handlers/compose-video";

const logger = createScopedLogger({ module: "worker" });

const handlers: Record<string, (payload: TaskPayload) => Promise<void>> = {
  [TaskType.VIDEO_ANALYZE]: handleVideoAnalyze,
  [TaskType.REWRITE]: handleRewrite,
  [TaskType.GENERATE_STORYBOARD]: handleGenerateStoryboard,
  [TaskType.GENERATE_PANEL_IMAGE]: handleGeneratePanelImage,
  [TaskType.GENERATE_PANEL_VIDEO]: handleGeneratePanelVideo,
  [TaskType.COMPOSE_VIDEO]: handleComposeVideo,
};

async function processJob(payload: TaskPayload) {
  const handler = handlers[payload.type];
  if (!handler) {
    throw new Error(`No handler for task type: ${payload.type}`);
  }
  await handler(payload);
}

async function bootRecovery() {
  try {
    const result = await prisma.task.updateMany({
      where: { status: "running" },
      data: { status: "pending", heartbeatAt: null },
    });
    if (result.count > 0) {
      logger.warn({ message: `Boot recovery: reset ${result.count} running tasks to pending` });
    }
  } catch (error) {
    logger.error("Boot recovery failed", error);
  }
}

function startWorkers() {
  const concurrency = {
    [QUEUE_NAMES.text]: parseInt(process.env.WORKER_TEXT_CONCURRENCY ?? "10"),
    [QUEUE_NAMES.image]: parseInt(process.env.WORKER_IMAGE_CONCURRENCY ?? "5"),
    [QUEUE_NAMES.video]: parseInt(process.env.WORKER_VIDEO_CONCURRENCY ?? "3"),
    [QUEUE_NAMES.voice]: parseInt(process.env.WORKER_VOICE_CONCURRENCY ?? "5"),
  };

  for (const [queueName, conc] of Object.entries(concurrency)) {
    const worker = new Worker(
      queueName,
      async (job) => {
        logger.info({ message: `Processing ${job.name}`, taskId: job.id ?? undefined });
        await processJob(job.data as TaskPayload);
      },
      { connection: queueRedis as never, concurrency: conc }
    );

    worker.on("completed", (job) => {
      logger.info({ message: `Completed ${job.name}`, taskId: job.id ?? undefined });
    });

    worker.on("failed", (job, error) => {
      logger.error({ message: `Failed ${job?.name}`, taskId: job?.id ?? undefined, error: { name: error.name, message: error.message } });
    });

    logger.info({ message: `Started queue ${queueName}`, details: { concurrency: conc } });
  }
}

async function main() {
  await bootRecovery();
  startWorkers();
  logger.info("All workers started");
}

main().catch((err) => {
  logger.error("Worker startup failed", err);
  process.exit(1);
});
