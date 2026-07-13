import { parseChannelPage } from './parser.js';
import { fetchTelegramHtml } from './telegram.js';

function isFresh(payload, ttlSeconds, now) {
  if (!payload || !payload.generatedAt) return false;
  return now() - payload.generatedAt < ttlSeconds * 1000;
}

function mergePosts(existing = [], incoming = []) {
  const byId = new Map();
  for (const post of existing) byId.set(post.id, post);
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

function paginate(posts, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const total = Math.max(1, Math.ceil(posts.length / safePageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    items: posts.slice(start, start + safePageSize),
  };
}

async function refreshPayload(config, fetchHtml, now, previous) {
  let before = '';
  let channel = previous?.channel || { title: '', description: '' };
  let posts = previous?.posts || [];

  for (let index = 0; index < config.maxFetchPages; index += 1) {
    const html = await fetchHtml({ host: config.host, channel: config.channel, before });
    const page = parseChannelPage(html, config);
    if (page.channel.title) channel = page.channel;
    posts = mergePosts(posts, page.posts);
    const oldest = page.posts[page.posts.length - 1];
    if (!oldest || before === oldest.id) break;
    before = oldest.id;
  }

  if (config.limit) posts = posts.slice(0, config.limit);
  return { generatedAt: now(), channel, posts };
}

export function createChannelService({ store, config, fetchHtml = fetchTelegramHtml, now = () => Date.now() }) {
  return {
    async getPosts({ page = 1, pageSize = config.pageSize, refresh = false } = {}) {
      const cached = await store.getPayload(config.channel);
      const canUseCache = cached && !refresh && isFresh(cached, config.cacheTtl, now);
      const payload = canUseCache ? cached : await refreshPayload(config, fetchHtml, now, cached);
      if (!canUseCache) await store.setPayload(config.channel, payload);

      const result = paginate(payload.posts, page, pageSize);
      return {
        channel: payload.channel,
        posts: result.items,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalItems: payload.posts.length,
          hasNext: result.page < result.total,
          hasPrev: result.page > 1,
        },
        generatedAt: payload.generatedAt,
        fromCache: canUseCache,
        stale: false,
      };
    },
  };
}
