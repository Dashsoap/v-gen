import { prisma } from "@/lib/prisma";
import { getQueueByType, removeTaskJob } from "./queues";
import { publishTaskProgress } from "./publisher";
import type { TaskType, TaskPayload, TaskProgress } from "./types";

export async function publishTextChunk(
  taskId: string,
  chunk: string,
  projectId?: string
) {
  const msg: TaskProgress = {
    taskId,
    projectId,
    progress: 0,
    totalSteps: 0,
    status: "running",
    textChunk: chunk,
  };
  await publishTaskProgress(msg);
}

export async function createTask(params: {
  userId: string;
  projectId?: string;
  type: TaskType;
  data: Record<string, unknown>;
  totalSteps?: number;
}): Promise<string> {
  const task = await prisma.task.create({
    data: {
      userId: params.userId,
      projectId: params.projectId,
      type: params.type,
      status: "pending",
      payload: params.data as object,
      totalSteps: params.totalSteps ?? 1,
    },
  });

  const queue = getQueueByType(params.type);
  const job = await queue.add(params.type, {
    taskId: task.id,
    userId: params.userId,
    projectId: params.projectId,
    type: params.type,
    data: params.data,
  } satisfies TaskPayload);

  await prisma.task.update({
    where: { id: task.id },
    data: { bullJobId: job.id, status: "running", startedAt: new Date() },
  });

  return task.id;
}

export async function updateTaskProgress(
  taskId: string,
  progress: number,
  totalSteps?: number
) {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      progress,
      heartbeatAt: new Date(),
      ...(totalSteps !== undefined && { totalSteps }),
    },
  });

  await publishTaskProgress({
    taskId,
    projectId: task.projectId ?? undefined,
    progress,
    totalSteps: task.totalSteps,
    status: "running",
  });
}

export async function completeTask(
  taskId: string,
  result?: Record<string, unknown>
) {
  const now = new Date();
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "completed",
      result: (result ?? undefined) as object | undefined,
      progress: 100,
      completedAt: now,
      finishedAt: now,
    },
  });

  await publishTaskProgress({
    taskId,
    projectId: task.projectId ?? undefined,
    progress: 100,
    totalSteps: 100,
    status: "completed",
  });
}

export async function failTask(taskId: string, error: string, errorCode?: string) {
  const now = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "failed", error, errorCode, finishedAt: now },
  });

  const task = await prisma.task.findUnique({ where: { id: taskId } });

  await publishTaskProgress({
    taskId,
    projectId: task?.projectId ?? undefined,
    progress: task?.progress ?? 0,
    totalSteps: task?.totalSteps ?? 1,
    status: "failed",
    message: error,
  });
}

export async function touchTaskHeartbeat(taskId: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: { heartbeatAt: new Date() },
  });
}

export async function tryMarkTaskProcessing(taskId: string): Promise<boolean> {
  try {
    await prisma.task.updateMany({
      where: { id: taskId, status: { in: ["pending", "running"] } },
      data: {
        status: "running",
        startedAt: new Date(),
        heartbeatAt: new Date(),
        attempt: { increment: 1 },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelTask(
  taskId: string,
  userId: string
): Promise<{ cancelled: boolean; error?: string }> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
  });

  if (!task) return { cancelled: false, error: "Task not found" };
  if (task.status === "completed" || task.status === "failed") {
    return { cancelled: false, error: "Task already finished" };
  }

  const now = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "failed",
      error: "Cancelled by user",
      errorCode: "TASK_CANCELLED",
      finishedAt: now,
    },
  });

  if (task.bullJobId) {
    await removeTaskJob(task.bullJobId);
  }

  await publishTaskProgress({
    taskId,
    projectId: task.projectId ?? undefined,
    progress: task.progress,
    totalSteps: task.totalSteps,
    status: "failed",
    message: "Cancelled by user",
  });

  return { cancelled: true };
}

export async function dismissFailedTasks(
  taskIds: string[],
  userId: string
): Promise<number> {
  const result = await prisma.task.updateMany({
    where: {
      id: { in: taskIds.slice(0, 200) },
      userId,
      status: "failed",
    },
    data: { status: "dismissed" },
  });
  return result.count;
}
