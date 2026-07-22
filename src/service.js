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

function reconcilePosts(existing = [], incoming = []) {
  if (!incoming.length) return existing;

  const incomingIds = new Set(incoming.map((post) => post.id));
  const oldestIncomingTimestamp = Math.min(...incoming.map((post) => post.timestamp));
  const retained = existing.filter((post) => (
    post.timestamp < oldestIncomingTimestamp || incomingIds.has(post.id)
  ));
  return mergePosts(retained, incoming);
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

function buildResponse(payload, page, pageSize, { fromCache = false, stale = false, error = '' } = {}) {
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
    fromCache,
    stale,
    ...(error ? { error } : {}),
  };
}

async function refreshPayload(config, fetchHtml, now, previous) {
  let before = '';
  let channel = previous?.channel || { title: '', description: '' };
  const fetchedPosts = [];

  for (let index = 0; index < config.maxFetchPages; index += 1) {
    const html = await fetchHtml({ host: config.host, channel: config.channel, before });
    const page = parseChannelPage(html, config);
    if (page.channel.title) channel = page.channel;
    fetchedPosts.push(...page.posts);
    const oldest = page.posts[page.posts.length - 1];
    if (!oldest || before === oldest.id) break;
    before = oldest.id;
  }

  let posts = reconcilePosts(previous?.posts || [], fetchedPosts);
  if (config.limit) posts = posts.slice(0, config.limit);
  return { generatedAt: now(), channel, posts };
}

export function createChannelService({
  store,
  config,
  fetchHtml = fetchTelegramHtml,
  now = () => Date.now(),
  random = Math.random,
}) {
  const getPosts = async ({ page = 1, pageSize = config.pageSize, refresh = false } = {}) => {
    const cached = await store.getPayload(config.channel);
    const canUseCache = cached && !refresh && isFresh(cached, config.cacheTtl, now);
    if (canUseCache) return buildResponse(cached, page, pageSize, { fromCache: true });

    try {
      const refreshOperation = async () => {
        const latestCached = await store.getPayload(config.channel);
        const latestCanUseCache = latestCached && !refresh && isFresh(latestCached, config.cacheTtl, now);
        if (latestCanUseCache) return latestCached;

        const payload = await refreshPayload(config, fetchHtml, now, latestCached || cached);
        await store.setPayload(config.channel, payload);
        return payload;
      };
      const payload = typeof store.withRefreshLock === 'function'
        ? await store.withRefreshLock(config.channel, refreshOperation)
        : await refreshOperation();
      return buildResponse(payload, page, pageSize, { fromCache: payload === cached });
    } catch (error) {
      if (!cached) throw error;
      return buildResponse(cached, page, pageSize, {
        fromCache: true,
        stale: true,
        error: error.message || 'Refresh failed',
      });
    }
  };

  const getRandomPost = async ({ poolSize = config.pageSize } = {}) => {
    const result = await getPosts({ page: 1, pageSize: poolSize });
    const index = result.posts.length ? Math.floor(random() * result.posts.length) : -1;
    return {
      channel: result.channel,
      post: index >= 0 ? result.posts[index] : null,
      poolSize: result.posts.length,
      generatedAt: result.generatedAt,
      fromCache: result.fromCache,
      stale: result.stale,
      ...(result.error ? { error: result.error } : {}),
    };
  };

  return {
    getPosts,
    getRandomPost,
  };
}
