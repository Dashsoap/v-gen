import { prisma } from "@/lib/prisma";
import { createScopedLogger } from "@/lib/logging";
import { failTask } from "@/lib/task/service";
import { publishTaskProgress } from "@/lib/task/publisher";

const logger = createScopedLogger({ module: "reconcile" });

export async function sweepStaleTasks(heartbeatTimeoutMs: number) {
  const timeoutAt = new Date(Date.now() - heartbeatTimeoutMs);
  const staleTasks = await prisma.task.findMany({
    where: {
      status: "running",
      heartbeatAt: { lt: timeoutAt },
    },
    take: 100,
  });

  for (const task of staleTasks) {
    logger.error({
      message: "Watchdog marking stale task as failed",
      taskId: task.id,
      projectId: task.projectId ?? undefined,
      errorCode: "WATCHDOG_TIMEOUT",
    });

    await failTask(task.id, "Task heartbeat timeout (watchdog)", "WATCHDOG_TIMEOUT");
  }

  return staleTasks.length;
}

export async function reconcileActiveTasks(graceMs = 30_000) {
  const graceAt = new Date(Date.now() - graceMs);
  const orphanedTasks = await prisma.task.findMany({
    where: {
      status: "running",
      heartbeatAt: null,
      createdAt: { lt: graceAt },
    },
    take: 100,
  });

  for (const task of orphanedTasks) {
    logger.warn({
      message: "Reconciling orphaned task (no heartbeat)",
      taskId: task.id,
      projectId: task.projectId ?? undefined,
    });

    await failTask(task.id, "Task orphaned — no heartbeat received", "WATCHDOG_TIMEOUT");

    await publishTaskProgress({
      taskId: task.id,
      projectId: task.projectId ?? undefined,
      progress: task.progress,
      totalSteps: task.totalSteps,
      status: "failed",
      message: "Task orphaned — no heartbeat received",
    });
  }

  return orphanedTasks.length;
}
