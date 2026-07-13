import { MemoryStore } from './store-memory.js';
import { RedisStore } from './store-redis.js';

const fallbackMemoryStore = new MemoryStore();

export function hasRedisEnv(env = process.env) {
  return Boolean(
    (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)
    && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN),
  );
}

export function createStoreFromEnv(env = process.env) {
  if (hasRedisEnv(env)) return new RedisStore();
  if (String(env.REQUIRE_REDIS || '').toLowerCase() === 'true') {
    throw new Error('Redis is required but missing. Connect Upstash Redis or set REQUIRE_REDIS=false.');
  }
  return fallbackMemoryStore;
}
