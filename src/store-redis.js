import { Redis } from '@upstash/redis';

export class RedisStore {
  constructor(redis = Redis.fromEnv(), prefix = 'bb-channel') {
    this.redis = redis;
    this.prefix = prefix;
  }

  key(channel) {
    return `${this.prefix}:${channel}:payload`;
  }

  lockKey(channel) {
    return `${this.prefix}:${channel}:refresh-lock`;
  }

  async getPayload(channel) {
    return this.redis.get(this.key(channel));
  }

  async setPayload(channel, payload) {
    await this.redis.set(this.key(channel), payload);
  }

  async withRefreshLock(channel, operation, { ttlMs = 15000, retryMs = 250, retries = 20 } = {}) {
    const key = this.lockKey(channel);
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const acquired = await this.redis.set(key, token, { nx: true, px: ttlMs });
      if (acquired) {
        try {
          return await operation();
        } finally {
          const current = await this.redis.get(key);
          if (current === token) await this.redis.del(key);
        }
      }
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }

    const cached = await this.getPayload(channel);
    if (cached) return cached;
    return operation();
  }
}
