# Random Post Batch API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing random-post endpoint to return up to ten unique recent posts in one request while preserving the exact legacy response when `count` is omitted.

**Architecture:** Add without-replacement sampling to `createChannelService`, keeping the old `getRandomPost()` method as a compatibility wrapper around a new `getRandomPosts()` method. The HTTP handler enters batch mode only when the request explicitly contains `count`; both paths continue to reuse `getPosts()` for cache, stale, pool-size, CORS, and error behavior.

**Tech Stack:** Node.js ESM, Vercel serverless functions, Upstash-backed channel service, Node.js built-in test runner

## Global Constraints

- Keep `GET /api/posts/random` and the existing rewrite; do not add a second endpoint.
- Keep `pool_size` normalization at 1–100 through the existing `getPosts()` pagination path.
- Normalize `count` to an integer in the 1–10 range, defaulting invalid or absent service values to 1.
- When the HTTP query omits `count`, return the legacy object with `post` and without `posts` or `count`.
- When the HTTP query explicitly includes `count`, return `post`, `posts`, and actual `count`; an empty result is `post: null`, `posts: []`, `count: 0`.
- Sample from page 1 of the recent pool, deduplicate normalized IDs, and never repeat an ID within one batch.
- Preserve `channel`, `poolSize`, `generatedAt`, `fromCache`, `stale`, optional `error`, CORS, and `cache-control: no-store`.
- Add no dependency and make no plugin or Blog change in this plan.
- Do not deploy until the full API test suite passes.

---

## File Map

- `src/service.js`: owns count normalization, unique candidate sampling, the new batch result, and the legacy wrapper.
- `api/random-post.js`: selects legacy or batch response based on the presence of the `count` query parameter.
- `test/service.test.js`: proves deterministic sampling, clamping, deduplication, empty results, route compatibility, and cache headers.
- `README.md`: documents the English request and response contracts.
- `README.zh-CN.md`: documents the same contracts in Chinese.

### Task 1: Unique batch sampling in the service

**Files:**
- Modify: `test/service.test.js:136-231`
- Modify: `src/service.js:1-139`

**Interfaces:**
- Consumes: `getPosts({ page: 1, pageSize: poolSize }) -> Promise<PostsResponse>` and the `random: () -> number` dependency already injected into `createChannelService()`.
- Produces: `normalizeSampleCount(value) -> integer` scoped to `src/service.js`.
- Produces: `samplePostsWithoutReplacement(posts, count, random) -> Post[]` scoped to `src/service.js`.
- Produces: `service.getRandomPosts({ poolSize?, count? }) -> Promise<BatchRandomResponse>`.
- Preserves: `service.getRandomPost({ poolSize? }) -> Promise<LegacyRandomResponse>` with no `posts` or `count` properties.

- [ ] **Step 1: Add deterministic batch and legacy-shape tests**

Insert the following after the existing `getRandomPost selects only from the requested recent pool` test in `test/service.test.js`:

```js
test('getRandomPosts samples unique posts from only the requested recent pool', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: Array.from({ length: 8 }, (_, index) => ({
      id: String(8 - index),
      timestamp: 8000 - index,
      datetime: '1970-01-01T00:00:08.000Z',
      text: `post-${8 - index}`,
      html: `<p>post-${8 - index}</p>`,
      tags: [], media: [], attachments: [], source: {},
    })),
  });
  const values = [0.8, 0, 0.6, 0.2, 0.9];
  let randomIndex = 0;
  const service = createChannelService({
    store,
    now: () => 1200,
    random: () => values[randomIndex++],
    config: {
      channel: 'unlimitmeme', cacheTtl: 60, pageSize: 20,
      maxFetchPages: 1, limit: 100,
    },
  });

  const result = await service.getRandomPosts({ poolSize: 6, count: 5 });

  assert.equal(result.posts.length, 5);
  assert.equal(new Set(result.posts.map(post => post.id)).size, 5);
  assert.equal(result.posts.every(post => Number(post.id) >= 3), true);
  assert.equal(result.post, result.posts[0]);
  assert.equal(result.count, 5);
  assert.equal(result.poolSize, 6);
  assert.equal(result.fromCache, true);
});

test('getRandomPost preserves the legacy response shape', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [{ id: '1', timestamp: 1, text: 'one' }],
  });
  const service = createChannelService({
    store,
    now: () => 1200,
    random: () => 0,
    config: {
      channel: 'unlimitmeme', cacheTtl: 60, pageSize: 20,
      maxFetchPages: 1, limit: 100,
    },
  });

  const result = await service.getRandomPost({ poolSize: 20 });

  assert.equal(result.post.id, '1');
  assert.equal(Object.hasOwn(result, 'posts'), false);
  assert.equal(Object.hasOwn(result, 'count'), false);
});
```

- [ ] **Step 2: Run the service tests to prove the new interface is missing**

Run:

```bash
node --test --test-name-pattern='getRandomPosts|legacy response shape' test/service.test.js
```

Expected: FAIL because `service.getRandomPosts` is not defined.

- [ ] **Step 3: Add count normalization and partial Fisher–Yates sampling**

Add these functions immediately after `paginate()` in `src/service.js`:

```js
function normalizeSampleCount(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : 1;
}

function samplePostsWithoutReplacement(posts, count, random) {
  const unique = new Map();
  for (const post of posts) {
    const id = String(post?.id || '').trim();
    if (id && !unique.has(id)) unique.set(id, post);
  }

  const candidates = [...unique.values()];
  const limit = Math.min(normalizeSampleCount(count), candidates.length);
  for (let index = 0; index < limit; index += 1) {
    const remaining = candidates.length - index;
    const rawOffset = Math.floor(random() * remaining);
    const offset = Math.max(0, Math.min(remaining - 1, rawOffset));
    const selected = index + offset;
    [candidates[index], candidates[selected]] = [candidates[selected], candidates[index]];
  }
  return candidates.slice(0, limit);
}
```

The bounds around `rawOffset` keep an injected value of exactly `1` from indexing past the array even though `Math.random()` normally returns values below `1`.

- [ ] **Step 4: Add the batch method and make the old method a shape-preserving wrapper**

Replace the current `getRandomPost` block and return object in `src/service.js` with:

```js
  const getRandomPosts = async ({ poolSize = config.pageSize, count = 1 } = {}) => {
    const result = await getPosts({ page: 1, pageSize: poolSize });
    const posts = samplePostsWithoutReplacement(result.posts, count, random);
    return {
      channel: result.channel,
      post: posts[0] || null,
      posts,
      count: posts.length,
      poolSize: result.posts.length,
      generatedAt: result.generatedAt,
      fromCache: result.fromCache,
      stale: result.stale,
      ...(result.error ? { error: result.error } : {}),
    };
  };

  const getRandomPost = async ({ poolSize = config.pageSize } = {}) => {
    const { posts, count, ...legacy } = await getRandomPosts({ poolSize, count: 1 });
    return legacy;
  };

  return {
    getPosts,
    getRandomPost,
    getRandomPosts,
  };
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
node --test --test-name-pattern='getRandomPost|legacy response shape' test/service.test.js
```

Expected: all matching tests PASS, including the existing pool clamp and empty-channel tests.

- [ ] **Step 6: Add clamping, deduplication, fewer-than-requested, and empty-batch tests**

Insert this test after the new batch sampling test:

```js
test('getRandomPosts clamps count, deduplicates ids, and returns all available unique posts', async () => {
  const store = new MemoryStore();
  await store.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Cached', description: '' },
    posts: [
      { id: '3', timestamp: 3, text: 'three' },
      { id: ' 3 ', timestamp: 2, text: 'duplicate three' },
      { id: '2', timestamp: 1, text: 'two' },
    ],
  });
  const config = {
    channel: 'unlimitmeme', cacheTtl: 60, pageSize: 20,
    maxFetchPages: 1, limit: 100,
  };
  const service = createChannelService({ store, now: () => 1200, random: () => 0, config });

  const maximum = await service.getRandomPosts({ count: 999 });
  const minimum = await service.getRandomPosts({ count: 0 });

  assert.deepEqual(maximum.posts.map(post => String(post.id).trim()), ['3', '2']);
  assert.equal(maximum.count, 2);
  assert.equal(minimum.count, 1);

  const emptyStore = new MemoryStore();
  await emptyStore.setPayload('unlimitmeme', {
    generatedAt: 1000,
    channel: { title: 'Empty', description: '' },
    posts: [],
  });
  const empty = await createChannelService({
    store: emptyStore, now: () => 1200, random: () => 0, config,
  }).getRandomPosts({ count: 5 });

  assert.equal(empty.post, null);
  assert.deepEqual(empty.posts, []);
  assert.equal(empty.count, 0);
});
```

- [ ] **Step 7: Run the complete service test file**

Run:

```bash
node --test test/service.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit the service behavior**

```bash
git add src/service.js test/service.test.js
git commit -m "Add random post batch sampling"
```

### Task 2: Backward-compatible HTTP contract and documentation

**Files:**
- Modify: `test/service.test.js:362-431`
- Modify: `api/random-post.js:1-19`
- Modify: `README.md:173-196`
- Modify: `README.zh-CN.md:173-196`

**Interfaces:**
- Consumes: `service.getRandomPost({ poolSize })` and `service.getRandomPosts({ poolSize, count })` from Task 1.
- Produces: legacy JSON when `req.query` has no own `count` property.
- Produces: batch JSON when `Object.prototype.hasOwnProperty.call(req.query, 'count')` is true.

- [ ] **Step 1: Split the route test into explicit legacy and batch assertions**

In the existing `random posts API exposes the public route and disables edge caching` test, keep the current handler import, rewrite assertion, fetch/random stubs, and response object. Replace the single handler call and final assertions with:

```js
  try {
    await randomPostHandler({
      method: 'GET',
      headers: {},
      query: { pool_size: '2' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.post.id, '101');
    assert.equal(res.body.poolSize, 2);
    assert.equal(Object.hasOwn(res.body, 'posts'), false);
    assert.equal(Object.hasOwn(res.body, 'count'), false);
    assert.equal(headers.get('cache-control'), 'no-store');

    await randomPostHandler({
      method: 'GET',
      headers: {},
      query: { pool_size: '4', count: '3' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    Math.random = originalRandom;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.posts.length, 3);
  assert.equal(new Set(res.body.posts.map(post => post.id)).size, 3);
  assert.equal(res.body.post.id, res.body.posts[0].id);
  assert.equal(res.body.count, 3);
  assert.equal(res.body.poolSize, 4);
  assert.equal(headers.get('cache-control'), 'no-store');
```

- [ ] **Step 2: Run the route test to verify batch mode still fails**

Run:

```bash
node --test --test-name-pattern='random posts API exposes' test/service.test.js
```

Expected: FAIL because the handler still ignores `count` and returns no `posts` array.

- [ ] **Step 3: Route explicit count requests to the batch method**

Replace the body of the `try` block in `api/random-post.js` with:

```js
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
```

Keep the existing method checks and `setCors(req, res, config)` call unchanged.

- [ ] **Step 4: Run the route and full tests**

Run:

```bash
node --test --test-name-pattern='random posts API exposes' test/service.test.js
npm test
```

Expected: both commands PASS with zero failures.

- [ ] **Step 5: Document the dual response shape in English**

Replace the `GET /api/posts/random` section in `README.md` with:

````markdown
### `GET /api/posts/random`

Returns random posts from the most recent pool. `pool_size` defaults to `PAGE_SIZE` and is clamped to 1–100. Optional `count` is clamped to 1–10.

```http
GET /api/posts/random?pool_size=20&count=5
```

When `count` is omitted, the endpoint preserves the legacy response and returns only `post`. When `count` is explicitly provided, it also returns `posts` and the actual `count`; `post` remains the first selected item. Sampling is without replacement. If fewer unique posts are available, all available posts are returned.

```json
{
  "channel": { "title": "Channel title", "description": "" },
  "post": { "id": "101", "text": "Hello" },
  "posts": [
    { "id": "101", "text": "Hello" },
    { "id": "98", "text": "Another moment" }
  ],
  "count": 2,
  "poolSize": 20,
  "generatedAt": 1760000000000,
  "fromCache": true,
  "stale": false
}
```

An empty batch returns `post: null`, `posts: []`, and `count: 0`.
````

- [ ] **Step 6: Document the same contract in Chinese**

Replace the corresponding section in `README.zh-CN.md` with:

````markdown
### `GET /api/posts/random`

从最近的消息池中随机返回消息。`pool_size` 默认使用 `PAGE_SIZE` 并限制在 1–100；可选的 `count` 限制在 1–10。

```http
GET /api/posts/random?pool_size=20&count=5
```

省略 `count` 时，接口保持旧响应结构，只返回 `post`。显式传入 `count` 时，响应会增加 `posts` 和实际的 `count`，同时保留第一条消息作为 `post`。抽样不重复；可用的唯一消息少于请求数量时返回全部可用消息。

```json
{
  "channel": { "title": "Channel title", "description": "" },
  "post": { "id": "101", "text": "Hello" },
  "posts": [
    { "id": "101", "text": "Hello" },
    { "id": "98", "text": "Another moment" }
  ],
  "count": 2,
  "poolSize": 20,
  "generatedAt": 1760000000000,
  "fromCache": true,
  "stale": false
}
```

空批次返回 `post: null`、`posts: []` 和 `count: 0`。
````

- [ ] **Step 7: Run validation and inspect the diff**

Run:

```bash
npm test
git diff --check
git diff -- src/service.js api/random-post.js test/service.test.js README.md README.zh-CN.md
```

Expected: tests PASS, `git diff --check` prints nothing, and the diff contains no route, cache, CORS, or unrelated formatting changes.

- [ ] **Step 8: Commit the route contract and docs**

```bash
git add api/random-post.js test/service.test.js README.md README.zh-CN.md
git commit -m "Expose random post batches"
```

### Task 3: Deployment and live compatibility verification

**Files:**
- Verify only: `src/service.js`, `api/random-post.js`, `test/service.test.js`, `README.md`, `README.zh-CN.md`

**Interfaces:**
- Consumes: the Vercel project already connected to `kaaaaai/kaaaaai.tools.channel-api`.
- Produces: a live endpoint ready for the Blog request `?pool_size=20&count=5` while legacy callers remain valid.

- [ ] **Step 1: Confirm identity, repository, and clean validation**

Run:

```bash
gh auth switch --hostname github.com --user kaaaaai
test "$(gh api user --jq .login)" = kaaaaai
git remote get-url origin
npm test
git status --short
```

Expected: the login is `kaaaaai`, origin is `git@kaaaaai.github.com:kaaaaai/kaaaaai.tools.channel-api.git`, tests PASS, and only intended commits/files are present.

- [ ] **Step 2: Push the tested commits to trigger Vercel**

```bash
git push origin main
```

Expected: the push succeeds without force and the connected Vercel deployment starts.

- [ ] **Step 3: Verify the batch response on the live host**

Use the production origin already consumed by the Blog:

```bash
API_ORIGIN=https://kaaaaai-tools-channel-api.vercel.app
curl -fsS "$API_ORIGIN/api/posts/random?pool_size=20&count=5" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(!Array.isArray(x.posts)||x.posts.length<1||x.posts.length>5||new Set(x.posts.map(p=>String(p.id))).size!==x.posts.length||x.count!==x.posts.length||x.post?.id!==x.posts[0]?.id)process.exit(1);console.log(x.posts.map(p=>p.id).join(","))})'
```

Expected: prints 1–5 unique IDs and exits zero.

- [ ] **Step 4: Verify the legacy response remains structurally unchanged**

```bash
API_ORIGIN=https://kaaaaai-tools-channel-api.vercel.app
curl -fsS "$API_ORIGIN/api/posts/random?pool_size=20" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(!Object.hasOwn(x,"post")||Object.hasOwn(x,"posts")||Object.hasOwn(x,"count"))process.exit(1);console.log(x.post?.id||"empty")})'
```

Expected: prints one ID (or `empty`) and exits zero; the object has neither `posts` nor `count`.

- [ ] **Step 5: Hand off the verified API origin to the Blog plan**

Record the confirmed production origin in the execution notes and proceed to `docs/superpowers/plans/2026-07-22-bb-dry-brush-carousel.md`. No npm/plugin release is required.
