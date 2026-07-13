import { resolveConfig } from '../src/config.js';
import { sendJson, setCors } from '../src/http.js';

export default function handler(req, res) {
  const config = resolveConfig();
  setCors(req, res, config);
  if (req.method === 'OPTIONS') return res.status(204).end();

  return sendJson(res, 200, {
    ok: true,
    channel: config.channel,
    redisConfigured: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  }, 'no-store');
}
