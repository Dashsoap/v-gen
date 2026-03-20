import type Redis from "ioredis";
import { createSubscriber } from "@/lib/redis";
import { createScopedLogger } from "@/lib/logging";
import { TASK_PROGRESS_CHANNEL } from "@/lib/task/publisher";

const logger = createScopedLogger({ module: "sse" });

type MessageHandler = (data: string) => void;

class SharedSubscriber {
  private subscriber: Redis | null = null;
  private listeners = new Set<MessageHandler>();
  private connecting = false;

  private getConnection(): Redis {
    if (!this.subscriber) {
      this.subscriber = createSubscriber();
      this.subscriber.on("message", (_channel, message) => {
        for (const listener of this.listeners) {
          try {
            listener(message);
          } catch {
            // Don't let one listener crash others
          }
        }
      });
    }
    return this.subscriber;
  }

  async subscribe(handler: MessageHandler): Promise<() => void> {
    this.listeners.add(handler);

    if (this.listeners.size === 1 && !this.connecting) {
      this.connecting = true;
      try {
        const conn = this.getConnection();
        await conn.subscribe(TASK_PROGRESS_CHANNEL);
        logger.info({ message: "Subscribed to channel", details: { channel: TASK_PROGRESS_CHANNEL } });
      } catch (err) {
        logger.error("Failed to subscribe", err);
      } finally {
        this.connecting = false;
      }
    }

    return () => {
      this.listeners.delete(handler);

      if (this.listeners.size === 0 && this.subscriber) {
        this.subscriber.unsubscribe().catch(() => {});
        this.subscriber.quit().catch(() => {});
        this.subscriber = null;
        logger.info("Disconnected (no listeners)");
      }
    };
  }
}

export const sharedSubscriber = new SharedSubscriber();
