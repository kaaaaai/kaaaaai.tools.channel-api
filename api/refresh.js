import { createServiceFromEnv, sendJson, setCors } from '../src/http.js';

export default async function handler(req, res) {
  const { config, service } = createServiceFromEnv();
  setCors(req, res, config);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!config.refreshSecret || req.query.secret !== config.refreshSecret) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  try {
    const result = await service.getPosts({ page: 1, pageSize: config.pageSize, refresh: true });
    return sendJson(res, 200, result, 'no-store');
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}
