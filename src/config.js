export function parseInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolveConfig(env = process.env) {
  return {
    channel: env.TG_CHANNEL || env.CHANNEL || 'unlimitmeme',
    host: env.TG_HOST || 't.me',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '*')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    cacheTtl: parseInteger(env.CACHE_TTL, 300),
    pageSize: parseInteger(env.PAGE_SIZE, 20),
    maxFetchPages: parseInteger(env.MAX_FETCH_PAGES, 2),
    limit: parseInteger(env.POST_LIMIT, 500),
    staticProxy: env.STATIC_PROXY || '',
    refreshSecret: env.REFRESH_SECRET || '',
    requireRedis: String(env.REQUIRE_REDIS || '').toLowerCase() === 'true',
  };
}

export function isOriginAllowed(origin, allowedOrigins = ['*']) {
  if (!origin || allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(origin);
}
