import { isOriginAllowed, resolveConfig } from './config.js';
import { createChannelService } from './service.js';
import { RedisStore } from './store-redis.js';

export function setCors(req, res, config = resolveConfig()) {
  const origin = req.headers.origin || '';
  const allowOrigin = isOriginAllowed(origin, config.allowedOrigins) ? (origin || '*') : 'null';
  res.setHeader('access-control-allow-origin', allowOrigin);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

export function sendJson(res, status, body, cacheControl = '') {
  if (cacheControl) res.setHeader('cache-control', cacheControl);
  res.status(status).json(body);
}

export function createServiceFromEnv(env = process.env) {
  const config = resolveConfig(env);
  return {
    config,
    service: createChannelService({
      config,
      store: new RedisStore(),
    }),
  };
}
