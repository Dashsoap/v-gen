import Redis from "ioredis";

type RedisSingleton = {
  app?: Redis;
  queue?: Redis;
};

const globalForRedis = globalThis as typeof globalThis & {
  __vgenRedis?: RedisSingleton;
};

const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? "6379", 10) || 6379;

function buildBaseConfig() {
  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      return Math.min(2 ** Math.min(times, 10) * 100, 30_000);
    },
  };
}

function createAppRedis() {
  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: 2,
  });
  client.on("connect", () => console.log(`[Redis:app] connected ${REDIS_HOST}:${REDIS_PORT}`));
  client.on("error", (err) => console.error(`[Redis:app] error:`, err.message));
  return client;
}

function createQueueRedis() {
  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: null,
  });
  client.on("connect", () => console.log(`[Redis:queue] connected ${REDIS_HOST}:${REDIS_PORT}`));
  client.on("error", (err) => console.error(`[Redis:queue] error:`, err.message));
  return client;
}

export function createSubscriber() {
  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: null,
  });
  client.on("connect", () => console.log(`[Redis:sub] connected ${REDIS_HOST}:${REDIS_PORT}`));
  client.on("error", (err) => console.error(`[Redis:sub] error:`, err.message));
  return client;
}

const singleton = globalForRedis.__vgenRedis || {};
if (!globalForRedis.__vgenRedis) {
  globalForRedis.__vgenRedis = singleton;
}

export const redis = singleton.app || (singleton.app = createAppRedis());
export const queueRedis = singleton.queue || (singleton.queue = createQueueRedis());
