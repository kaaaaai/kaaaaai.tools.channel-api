import { resolveConfig } from '../src/config.js';
import { sendJson, setCors } from '../src/http.js';
import { hasRedisEnv } from '../src/store.js';

export default function handler(req, res) {
  const config = resolveConfig();
  setCors(req, res, config);
  if (req.method === 'OPTIONS') return res.status(204).end();

  return sendJson(res, 200, {
    ok: true,
    channel: config.channel,
    redisConfigured: hasRedisEnv(process.env),
    requireRedis: config.requireRedis,
  }, 'no-store');
}
