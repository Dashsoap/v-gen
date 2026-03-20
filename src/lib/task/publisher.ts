import type { TaskProgress } from "./types";

const CHANNEL = "vgen-task-progress";

export async function publishTaskProgress(progress: TaskProgress) {
  const { redis } = await import("@/lib/redis");
  await redis.publish(CHANNEL, JSON.stringify(progress));
}

export { CHANNEL as TASK_PROGRESS_CHANNEL };
