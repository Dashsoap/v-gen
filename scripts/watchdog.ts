import { createScopedLogger } from "@/lib/logging/core";
import { sweepStaleTasks, reconcileActiveTasks } from "@/lib/task/reconcile";

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || "30000", 10) || 30000;
const HEARTBEAT_TIMEOUT_MS =
  parseInt(process.env.TASK_HEARTBEAT_TIMEOUT_MS || "60000", 10) || 60000;

const logger = createScopedLogger({
  module: "watchdog",
  action: "watchdog.tick",
});

async function tick() {
  const startedAt = Date.now();
  try {
    const stale = await sweepStaleTasks(HEARTBEAT_TIMEOUT_MS);
    const orphaned = await reconcileActiveTasks();
    logger.info({
      message: "Watchdog tick completed",
      action: "watchdog.tick.ok",
      durationMs: Date.now() - startedAt,
      details: { staleRecovered: stale, orphanedRecovered: orphaned },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "watchdog tick failed";
    logger.error({
      message,
      action: "watchdog.tick.failed",
      durationMs: Date.now() - startedAt,
      errorCode: "INTERNAL_ERROR",
    });
  }
}

logger.info({
  message: "Watchdog started",
  action: "watchdog.started",
  details: { intervalMs: INTERVAL_MS, heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS },
});

void tick();
setInterval(() => {
  void tick();
}, INTERVAL_MS);
