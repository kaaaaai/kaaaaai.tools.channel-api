import { createServiceFromEnv, sendJson, setCors } from '../src/http.js';

export default async function handler(req, res) {
  const { config, service } = createServiceFromEnv();
  setCors(req, res, config);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const result = await service.getPosts({
      page: req.query.page,
      pageSize: req.query.page_size || req.query.pageSize,
    });
    return sendJson(res, 200, result, `public, s-maxage=${config.cacheTtl}, stale-while-revalidate=86400`);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}
