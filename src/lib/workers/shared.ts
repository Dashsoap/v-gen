import { UnrecoverableError } from "bullmq";
import { updateTaskProgress, completeTask, failTask, touchTaskHeartbeat, publishTextChunk } from "@/lib/task/service";
import { createScopedLogger } from "@/lib/logging";
import { normalizeAnyError } from "@/lib/errors";
import type { TaskPayload } from "@/lib/task/types";

type TaskHandler = (
  payload: TaskPayload,
  ctx: TaskContext
) => Promise<Record<string, unknown> | void>;

export interface TaskContext {
  reportProgress: (progress: number, totalSteps?: number) => Promise<void>;
  publishText: (chunk: string) => void;
  flushText: () => Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 10_000;

export function withTaskLifecycle(handler: TaskHandler) {
  return async (payload: TaskPayload): Promise<void> => {
    const { taskId } = payload;
    const logger = createScopedLogger({
      module: "worker",
      taskId,
      action: payload.type,
    });

    const heartbeatTimer = setInterval(() => {
      touchTaskHeartbeat(taskId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    let textBuffer = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const TEXT_BUFFER_MS = 50;

    const flushText = async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (textBuffer) {
        const chunk = textBuffer;
        textBuffer = "";
        await publishTextChunk(taskId, chunk, payload.projectId);
      }
    };

    const ctx: TaskContext = {
      reportProgress: (progress: number, totalSteps?: number) =>
        updateTaskProgress(taskId, progress, totalSteps),
      publishText: (chunk: string) => {
        textBuffer += chunk;
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flushText().catch(() => {});
          }, TEXT_BUFFER_MS);
        }
      },
      flushText,
    };

    try {
      const result = await handler(payload, ctx);
      await flushText();
      await completeTask(taskId, result ?? undefined);
    } catch (error) {
      const normalized = normalizeAnyError(error, { context: "worker" });
      const message = error instanceof Error ? error.message : String(error);

      logger.error({
        message: `Task ${taskId} failed: ${message}`,
        errorCode: normalized.code,
        retryable: normalized.retryable,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
      });

      await failTask(taskId, message, normalized.code);

      if (normalized.retryable) {
        throw error;
      } else {
        throw new UnrecoverableError(message);
      }
    } finally {
      clearInterval(heartbeatTimer);
      if (flushTimer) clearTimeout(flushTimer);
      await flushText().catch(() => {});
    }
  };
}
