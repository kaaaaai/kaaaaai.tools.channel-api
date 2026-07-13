# tg-channel-api

Vercel API template for serving public Telegram channel messages to static blogs.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKaaaaai%2Ftg-channel-api&project-name=tg-channel-api&repository-name=tg-channel-api&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%2C%22allowConnectExistingProduct%22%3Atrue%7D%5D&env=TG_CHANNEL,ALLOWED_ORIGINS,REFRESH_SECRET&CACHE_TTL=300&PAGE_SIZE=20&MAX_FETCH_PAGES=2&POST_LIMIT=500)

The deploy flow creates or connects an Upstash Redis store and injects Redis environment variables into Vercel.

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TG_CHANNEL` | yes | `unlimitmeme` | Public Telegram channel username without `@`. |
| `ALLOWED_ORIGINS` | no | `*` | Comma-separated CORS allowlist, for example `https://www.example.com`. |
| `CACHE_TTL` | no | `300` | Fresh-cache window in seconds. |
| `PAGE_SIZE` | no | `20` | Default page size. |
| `MAX_FETCH_PAGES` | no | `2` | Telegram public pages to fetch when refreshing. |
| `POST_LIMIT` | no | `500` | Maximum posts retained in Redis. |
| `REFRESH_SECRET` | yes | empty | Secret for `POST /api/refresh?secret=...`. |

## API

```text
GET  /api/posts?page=1&page_size=20
POST /api/refresh?secret=...
GET  /api/health
```

`/api/posts` returns JSON:

```json
{
  "channel": { "title": "Channel", "description": "Description" },
  "posts": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalItems": 0,
    "hasNext": false,
    "hasPrev": false
  },
  "generatedAt": 1760000000000,
  "fromCache": true,
  "stale": false
}
```

## Local Development

```bash
npm install
npm test
vercel dev
```

For local Redis testing, copy `.env.example` to `.env.local` and add the Upstash variables from Vercel:

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```
