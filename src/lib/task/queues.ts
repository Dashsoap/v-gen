import { Queue } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { QUEUE_NAMES } from "./types";

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: queueRedis as never,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

let _textQueue: Queue | null = null;
let _imageQueue: Queue | null = null;
let _videoQueue: Queue | null = null;
let _voiceQueue: Queue | null = null;

export function getTextQueue(): Queue {
  if (!_textQueue) _textQueue = createQueue(QUEUE_NAMES.text);
  return _textQueue;
}

export function getImageQueue(): Queue {
  if (!_imageQueue) _imageQueue = createQueue(QUEUE_NAMES.image);
  return _imageQueue;
}

export function getVideoQueue(): Queue {
  if (!_videoQueue) _videoQueue = createQueue(QUEUE_NAMES.video);
  return _videoQueue;
}

export function getVoiceQueue(): Queue {
  if (!_voiceQueue) _voiceQueue = createQueue(QUEUE_NAMES.voice);
  return _voiceQueue;
}

export function getQueueByType(type: string): Queue {
  if (type.includes("IMAGE")) return getImageQueue();
  if (type.includes("VIDEO") || type === "COMPOSE_VIDEO") return getVideoQueue();
  if (type.includes("VOICE")) return getVoiceQueue();
  return getTextQueue();
}

export function getAllQueues(): Queue[] {
  return [getTextQueue(), getImageQueue(), getVideoQueue(), getVoiceQueue()];
}

export async function removeTaskJob(bullJobId: string): Promise<boolean> {
  for (const queue of getAllQueues()) {
    const job = await queue.getJob(bullJobId);
    if (job) {
      try {
        await job.remove();
      } catch {
        // Job may already be active/completed
      }
      return true;
    }
  }
  return false;
}
