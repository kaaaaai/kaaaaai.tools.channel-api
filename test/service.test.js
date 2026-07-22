import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createChannelService } from '../src/service.js';
import { createStoreFromEnv, hasRedisEnv } from '../src/store.js';
import { MemoryStore } from '../src/store-memory.js';
import { parseChannelPage } from '../src/parser.js';
import postsHandler from '../api/posts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function fixture(name) {
  return readFile(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('parseChannelPage extracts public Telegram posts and channel metadata', async () => {
  const html = await fixture('channel-page.html');
  const payload = parseChannelPage(html, { channel: 'unlimitmeme', staticProxy: 'https://cdn.example.test/static/' });

  assert.equal(payload.channel.title, 'KaaaaaiのMeme角落');
  assert.equal(payload.channel.description, '操作主人公在地球 Online 游戏出 Bug 时收集到的一些胡言乱语片段');
  assert.deepEqual(payload.posts.map((post) => post.id), ['101', '100', '99', '98']);
  assert.equal(payload.posts.some((post) => post.id === '1000'), false);
  assert.equal(payload.posts.some((post) => post.id === '999'), false);
  assert.equal(payload.posts[0].source.telegramUrl, 'https://t.me/unlimitmeme/101');
  assert.deepEqual(payload.posts[0].tags, ['Tools']);
  assert.deepEqual(payload.posts[0].attachments, [{
    type: 'document',
    title: 'Navicat_Premium_17.1.2.dmg',
    meta: '351.5 MB',
    url: 'https://t.me/unlimitmeme/101',
  }]);
  assert.equal(payload.posts[1].media[0].src, 'https://cdn.example.test/static/https%3A%2F%2Fcdn.example.com%2Fimage.jpg');
  assert.deepEqual(payload.posts[2].tags, ['Notion风格头像', '头像', 'Tools']);
  assert.match(payload.posts[2].html, /href="https:\/\/t\.me\/s\/unlimitmeme\?q=%23Tools"/);
  assert.deepEqual(payload.posts[3].tags, []);
});

test('runtime dependencies avoid sanitize-html because it breaks Vercel serverless ESM bundling', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.dependencies['sanitize-html'], undefined);
});

test('createStoreFromEnv falls back to memory when Upstash Redis env is missing', () => {
  assert.equal(hasRedisEnv({}), false);
  assert.ok(createStoreFromEnv({}) instanceof MemoryStore);
  assert.equal(hasRedisEnv({
    UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
    UPSTASH_REDIS_REST_TOKEN: 'secret',
  }), true);
});

test('createStoreFromEnv throws when REQUIRE_REDIS is true and Redis env is missing', () => {
  assert.throws(
    () => createStoreFromEnv({ REQUIRE_REDIS: 'true' }),
    /Redis is required but missing/,
  );
});

test('getPosts serves fresh cache without fetching Telegram', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [{ id: '1', timestamp: 1000, datetime: '1970-01-01T00:00:01.000Z', html: '<p>cached</p>', tags: [], media: [], source: {} }],
  });

  const service = createChannelService({
    store,
    now: () => 1200,
    fetchHtml: async () => {
      throw new Error('should not fetch');
    },
    config: {
      channel: 'unlimitmeme',
      cacheTtl: 60,
      pageSize: 20,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  const result = await service.getPosts({ page: 1, pageSize: 20 });

  assert.equal(result.fromCache, true);
  assert.equal(result.stale, false);
  assert.equal(result.posts[0].id, '1');
});

test('getPosts refreshes stale cache, merges new posts, and paginates', async () => {
  const html = await fixture('channel-page.html');
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [{ id: '99', timestamp: 99, datetime: '1970-01-01T00:00:00.099Z', html: '<p>older</p>', tags: [], media: [], source: {} }],
  });

  const requests = [];
  const service = createChannelService({
    store,
    now: () => 120000,
    fetchHtml: async (params) => {
      requests.push(params);
      return html;
    },
    config: {
      channel: 'unlimitmeme',
      host: 't.me',
      cacheTtl: 60,
      pageSize: 2,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  const firstPage = await service.getPosts({ page: 1, pageSize: 2 });
  const secondPage = await service.getPosts({ page: 2, pageSize: 2 });

  assert.equal(requests.length, 1);
  assert.deepEqual(firstPage.posts.map((post) => post.id), ['101', '100']);
  assert.deepEqual(secondPage.posts.map((post) => post.id), ['99', '98']);
  assert.equal(firstPage.pagination.total, 2);
  assert.equal(firstPage.fromCache, false);
  assert.equal(secondPage.fromCache, true);
});

test('getRandomPost selects only from the requested recent pool', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [
      { id: '4', timestamp: 4000, datetime: '1970-01-01T00:00:04.000Z', text: 'four', html: '<p>four</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '3', timestamp: 3000, datetime: '1970-01-01T00:00:03.000Z', text: 'three', html: '<p>three</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '2', timestamp: 2000, datetime: '1970-01-01T00:00:02.000Z', text: 'two', html: '<p>two</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '1', timestamp: 1000, datetime: '1970-01-01T00:00:01.000Z', text: 'one', html: '<p>one</p>', tags: [], media: [], attachments: [], source: {} },
    ],
  });

  const service = createChannelService({
    store,
    now: () => 1200,
    random: () => 0.75,
    fetchHtml: async () => {
      throw new Error('should not fetch');
    },
    config: {
      channel: 'unlimitmeme',
      cacheTtl: 60,
      pageSize: 20,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  assert.equal(typeof service.getRandomPost, 'function');
  const result = await service.getRandomPost({ poolSize: 2 });

  assert.equal(result.post.id, '3');
  assert.equal(result.poolSize, 2);
  assert.equal(result.fromCache, true);
});

test('getPosts removes cached posts missing from the refreshed Telegram window', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [
      { id: '101', timestamp: 101000, datetime: '1970-01-01T00:01:41.000Z', html: '<p>kept recent</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '100', timestamp: 100000, datetime: '1970-01-01T00:01:40.000Z', html: '<p>deleted remotely</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '99', timestamp: 99000, datetime: '1970-01-01T00:01:39.000Z', html: '<p>kept fetched</p>', tags: [], media: [], attachments: [], source: {} },
      { id: '1', timestamp: 1000, datetime: '1970-01-01T00:00:01.000Z', html: '<p>older than refreshed window</p>', tags: [], media: [], attachments: [], source: {} },
    ],
  });

  const service = createChannelService({
    store,
    now: () => 120000,
    fetchHtml: async () => `
      <div class="tgme_widget_message" data-post="unlimitmeme/101">
        <time datetime="1970-01-01T00:01:41.000Z"></time>
        <div class="tgme_widget_message_text">kept recent</div>
      </div>
      <div class="tgme_widget_message" data-post="unlimitmeme/99">
        <time datetime="1970-01-01T00:01:39.000Z"></time>
        <div class="tgme_widget_message_text">kept fetched</div>
      </div>
    `,
    config: {
      channel: 'unlimitmeme',
      host: 't.me',
      cacheTtl: 60,
      pageSize: 10,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  const result = await service.getPosts({ page: 1, pageSize: 10 });

  assert.deepEqual(result.posts.map((post) => post.id), ['101', '99', '1']);
});

test('getPosts returns stale cache when Telegram refresh fails', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [{ id: '1', timestamp: 1000, datetime: '1970-01-01T00:00:01.000Z', html: '<p>cached</p>', tags: [], media: [], attachments: [], source: {} }],
  });

  const service = createChannelService({
    store,
    now: () => 120000,
    fetchHtml: async () => {
      throw new Error('Telegram down');
    },
    config: {
      channel: 'unlimitmeme',
      host: 't.me',
      cacheTtl: 60,
      pageSize: 20,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  const result = await service.getPosts({ page: 1, pageSize: 20 });

  assert.deepEqual(result.posts.map((post) => post.id), ['1']);
  assert.equal(result.fromCache, true);
  assert.equal(result.stale, true);
  assert.equal(result.error, 'Telegram down');
});

test('getPosts refreshes stale payload through store lock when available', async () => {
  const html = await fixture('channel-page.html');
  const store = new MemoryStore();
  let lockCalls = 0;
  store.withRefreshLock = async (_channel, operation) => {
    lockCalls += 1;
    return operation();
  };

  const service = createChannelService({
    store,
    now: () => 120000,
    fetchHtml: async () => html,
    config: {
      channel: 'unlimitmeme',
      host: 't.me',
      cacheTtl: 60,
      pageSize: 20,
      maxFetchPages: 1,
      limit: 100,
    },
  });

  await service.getPosts({ page: 1, pageSize: 20 });

  assert.equal(lockCalls, 1);
});

test('posts API disables edge caching so Redis freshness controls updates', async () => {
  const html = await fixture('channel-page.html');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => html,
  });

  const headers = new Map();
  const res = {
    statusCode: 0,
    body: undefined,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await postsHandler({
      method: 'GET',
      headers: {},
      query: { page: '1', page_size: '20' },
    }, res);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
});

test('random posts API exposes the public route and disables edge caching', async () => {
  let randomPostHandler;
  try {
    ({ default: randomPostHandler } = await import('../api/random-post.js'));
  } catch {}
  assert.equal(typeof randomPostHandler, 'function');

  const vercelConfig = JSON.parse(await readFile(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.deepEqual(vercelConfig.rewrites, [{
    source: '/api/posts/random',
    destination: '/api/random-post',
  }]);

  const html = await fixture('channel-page.html');
  const originalFetch = global.fetch;
  const originalRandom = Math.random;
  global.fetch = async () => ({
    ok: true,
    text: async () => html,
  });
  Math.random = () => 0;

  const headers = new Map();
  const res = {
    statusCode: 0,
    body: undefined,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await randomPostHandler({
      method: 'GET',
      headers: {},
      query: { pool_size: '2' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    Math.random = originalRandom;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.post.id, '101');
  assert.equal(res.body.poolSize, 2);
  assert.equal(headers.get('cache-control'), 'no-store');
});
