# kaaaaai.tools.channel-api

English | [Chinese](./README.zh-CN.md)

> Vercel API template for turning a public Telegram channel into a cacheable JSON feed.

[![Vercel](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![Upstash](https://img.shields.io/badge/cache-Upstash%20Redis-00e9a3?style=flat-square)](https://upstash.com/)
[![Telegram](https://img.shields.io/badge/source-Telegram-26a5e4?style=flat-square&logo=telegram)](https://telegram.org/)
[![Live Demo](https://img.shields.io/badge/sample-kaaaaai.cn%2Fbb-ff7900?style=flat-square)](https://www.kaaaaai.cn/bb/)
[![License](https://img.shields.io/badge/license-MIT-black?style=flat-square)](./LICENSE)

`kaaaaai.tools.channel-api` fetches public Telegram channel pages, normalizes messages into JSON, caches the payload in Upstash Redis, and exposes a small API for static blogs.

Live sample: [https://www.kaaaaai.cn/bb/](https://www.kaaaaai.cn/bb/)

Companion Hexo plugin: [Kaaaaai/kaaaaai.tools.hexo-bb-channel](https://github.com/Kaaaaai/kaaaaai.tools.hexo-bb-channel)

## What You Get

- Public Telegram channel parsing without a Bot token
- Redis-backed cache with stale fallback
- Manual refresh endpoint protected by `REFRESH_SECRET`
- Pagination for static-blog timelines
- Random selection from a recent-post pool
- Real Telegram hashtag entity extraction
- Image and file attachment metadata
- CORS allowlist for blog domains
- Vercel one-click deploy with Upstash integration

## Architecture

```text
Telegram public channel
  └─ https://t.me/s/<TG_CHANNEL>

kaaaaai.tools.channel-api on Vercel
  ├─ fetches Telegram public HTML
  ├─ parses posts, media, files, tags
  ├─ stores normalized payload in Upstash Redis
  └─ exposes /api/posts to your blog

Static blog
  └─ fetches /api/posts at runtime
```

## Create a Telegram Channel

Before deploying the API, create a public Telegram channel and get its username:

1. Open Telegram on desktop or mobile.
2. Create a new channel: `New Channel`.
3. Fill in the channel name, description, and avatar.
4. Choose `Public Channel`.
5. Set a public link, for example `https://t.me/my_notes`.
6. Use only the username part as `TG_CHANNEL`, for example `my_notes`.
7. Publish at least one message in the channel.
8. Open `https://t.me/s/my_notes` in a browser or private window and confirm it is visible without logging in.

Important notes:

- Do not include `@` in `TG_CHANNEL`.
- Private channels are not supported.
- If `https://t.me/s/<TG_CHANNEL>` is not publicly accessible, this API cannot fetch the channel.
- A channel is different from a group. Use a Telegram channel for broadcast-style posts.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKaaaaai%2Fkaaaaai.tools.channel-api&project-name=kaaaaai-tools-channel-api&repository-name=kaaaaai.tools.channel-api&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%2C%22allowConnectExistingProduct%22%3Atrue%7D%5D&env=TG_CHANNEL,ALLOWED_ORIGINS,REFRESH_SECRET&CACHE_TTL=300&PAGE_SIZE=20&MAX_FETCH_PAGES=2&POST_LIMIT=500)

The Vercel flow can create or connect an Upstash Redis store and inject the Redis variables automatically.

### Required Setup

| Variable | Required | Example | Description |
| --- | --- | --- | --- |
| `TG_CHANNEL` | yes | `unlimitmeme` | Public Telegram channel username without `@`. |
| `REFRESH_SECRET` | yes | `openssl rand -hex 32` | Secret for `POST /api/refresh`. |

Generate a refresh secret locally:

```bash
openssl rand -hex 32
```

### Recommended Setup

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS allowlist, for example `https://www.example.com`. |
| `CACHE_TTL` | `300` | Fresh-cache window in seconds. |
| `PAGE_SIZE` | `20` | Default page size. |
| `MAX_FETCH_PAGES` | `2` | Telegram public pages to fetch during refresh. |
| `POST_LIMIT` | `500` | Maximum posts retained in Redis. |
| `STATIC_PROXY` | empty | Optional URL prefix for proxying Telegram static assets. |
| `REQUIRE_REDIS` | `false` | If `true`, fail fast when Redis env is missing. |

### Redis Variables

The API accepts both Vercel KV and Upstash naming:

```env
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

or:

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

If Redis is not configured and `REQUIRE_REDIS` is not `true`, the API falls back to in-memory cache. That is useful for local testing but not reliable for production serverless deployments.

## API Reference

### `GET /api/posts`

Returns paginated posts.

```http
GET /api/posts?page=1&page_size=20
```

Response:

```json
{
  "channel": {
    "title": "Channel title",
    "description": "Channel description"
  },
  "posts": [
    {
      "id": "101",
      "timestamp": 1760000000000,
      "datetime": "2026-01-01T12:00:00.000Z",
      "html": "<p>Hello <a href=\"https://t.me/s/channel?q=%23Tools\">#Tools</a></p>",
      "tags": ["Tools"],
      "media": [
        {
          "type": "image",
          "src": "https://..."
        }
      ],
      "attachments": [
        {
          "title": "Navicat_Premium_17.1.2.dmg",
          "meta": "351.5 MB",
          "url": "https://t.me/channel/101"
        }
      ],
      "source": {
        "telegramUrl": "https://t.me/channel/101"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 3,
    "totalItems": 60,
    "hasNext": true,
    "hasPrev": false
  },
  "generatedAt": 1760000000000,
  "fromCache": true,
  "stale": false
}
```

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

### `POST /api/refresh`

Forces a refresh from Telegram.

```http
POST /api/refresh?secret=<REFRESH_SECRET>
```

Use it from a cron job, a manual script, or a webhook-like action.

```bash
curl -X POST "https://your-channel-api.vercel.app/api/refresh?secret=$REFRESH_SECRET"
```

### `GET /api/health`

Health check and deployment sanity check.

```http
GET /api/health
```

Example:

```json
{
  "ok": true,
  "channel": "unlimitmeme",
  "redisConfigured": true,
  "requireRedis": false
}
```

## Use With Hexo

Install the companion plugin in your Hexo project:

```bash
npm install github:Kaaaaai/kaaaaai.tools.hexo-bb-channel
```

Configure `_config.yml`:

```yml
bb_channel:
  enable: true
  route: bb/
  title: moments
  description: Notes captured from a Telegram channel
  api_base: https://your-channel-api.vercel.app
  page_size: 20
```

Rebuild your blog:

```bash
hexo clean
hexo generate
hexo server
```

Open `/bb/`.

## Local Development

```bash
npm install
npm test
```

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Run with Vercel CLI:

```bash
vercel dev
```

Check:

```bash
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/posts?page=1&page_size=5"
```

## Refresh Strategy

`GET /api/posts` uses Redis freshness controlled by `CACHE_TTL`. If the cache is stale, the service refreshes Telegram and merges the latest fetched window with older cached posts.

For more predictable updates, call `POST /api/refresh` from a scheduled job:

```bash
curl -X POST "https://your-channel-api.vercel.app/api/refresh?secret=$REFRESH_SECRET"
```

## Limitations

- Only public Telegram channels are supported.
- The project parses Telegram public web HTML, so Telegram markup changes may require parser updates.
- Private channels, login-only content, and protected assets are outside the current scope.
- Serverless in-memory cache is not durable; use Upstash Redis for production.

## Security Notes

- Never expose `REFRESH_SECRET` in client-side code.
- Keep Redis credentials only in Vercel environment variables.
- Set `ALLOWED_ORIGINS` to your real blog domain for production, for example `https://www.kaaaaai.cn`.

## Related

- Hexo plugin: [Kaaaaai/kaaaaai.tools.hexo-bb-channel](https://github.com/Kaaaaai/kaaaaai.tools.hexo-bb-channel)
- Live sample: [https://www.kaaaaai.cn/bb/](https://www.kaaaaai.cn/bb/)

## License

MIT
