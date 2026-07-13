import { Redis } from '@upstash/redis';

export class RedisStore {
  constructor(redis = Redis.fromEnv(), prefix = 'bb-channel') {
    this.redis = redis;
    this.prefix = prefix;
  }

  key(channel) {
    return `${this.prefix}:${channel}:payload`;
  }

  async getPayload(channel) {
    return this.redis.get(this.key(channel));
  }

  async setPayload(channel, payload) {
    await this.redis.set(this.key(channel), payload);
  }
}
