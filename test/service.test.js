import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createChannelService } from '../src/service.js';
import { MemoryStore } from '../src/store-memory.js';
import { parseChannelPage } from '../src/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  return readFile(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('parseChannelPage extracts public Telegram posts and channel metadata', async () => {
  const html = await fixture('channel-page.html');
  const payload = parseChannelPage(html, { channel: 'unlimitmeme', staticProxy: 'https://cdn.example.test/static/' });

  assert.equal(payload.channel.title, 'KaaaaaiのMeme角落');
  assert.equal(payload.channel.description, '操作主人公在地球 Online 游戏出 Bug 时收集到的一些胡言乱语片段');
  assert.deepEqual(payload.posts.map((post) => post.id), ['101', '100']);
  assert.equal(payload.posts[0].source.telegramUrl, 'https://t.me/unlimitmeme/101');
  assert.deepEqual(payload.posts[0].tags, ['Tools']);
  assert.equal(payload.posts[1].media[0].src, 'https://cdn.example.test/static/https%3A%2F%2Fcdn.example.com%2Fimage.jpg');
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
  assert.deepEqual(secondPage.posts.map((post) => post.id), ['99']);
  assert.equal(firstPage.pagination.total, 2);
  assert.equal(firstPage.fromCache, false);
  assert.equal(secondPage.fromCache, true);
});
