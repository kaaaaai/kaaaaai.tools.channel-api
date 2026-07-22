import { createServiceFromEnv, sendJson, setCors } from '../src/http.js';

export default async function handler(req, res) {
  const { config, service } = await createServiceFromEnv();
  setCors(req, res, config);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const query = req.query || {};
    const poolSize = query.pool_size || query.poolSize;
    const hasCount = Object.prototype.hasOwnProperty.call(query, 'count');
    const result = hasCount
      ? await service.getRandomPosts({ poolSize, count: query.count })
      : await service.getRandomPost({ poolSize });
    return sendJson(res, 200, result, 'no-store');
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}
