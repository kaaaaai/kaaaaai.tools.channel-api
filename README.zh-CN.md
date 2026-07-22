# kaaaaai.tools.channel-api

[English](./README.md) | 简体中文

> 将公开 Telegram Channel 转换为可缓存 JSON Feed 的 Vercel API 模板。

[![Vercel](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)
[![Upstash](https://img.shields.io/badge/cache-Upstash%20Redis-00e9a3?style=flat-square)](https://upstash.com/)
[![Telegram](https://img.shields.io/badge/source-Telegram-26a5e4?style=flat-square&logo=telegram)](https://telegram.org/)
[![在线示例](https://img.shields.io/badge/sample-kaaaaai.cn%2Fbb-ff7900?style=flat-square)](https://www.kaaaaai.cn/bb/)
[![License](https://img.shields.io/badge/license-MIT-black?style=flat-square)](./LICENSE)

`kaaaaai.tools.channel-api` 会抓取公开 Telegram Channel 页面，将消息标准化为 JSON，并缓存到 Upstash Redis，供 Hexo 等静态博客动态展示。

在线示例：[https://www.kaaaaai.cn/bb/](https://www.kaaaaai.cn/bb/)

配套 Hexo 插件：[Kaaaaai/kaaaaai.tools.hexo-bb-channel](https://github.com/Kaaaaai/kaaaaai.tools.hexo-bb-channel)

## 能力概览

- 无需 Bot Token，直接解析公开 Telegram Channel
- Redis 缓存，刷新失败时可回退旧缓存
- 使用 `REFRESH_SECRET` 保护手动刷新接口
- 支持静态博客时间流分页
- 支持从最近消息池随机返回一条消息
- 基于 Telegram 原生 entity 提取 hashtag
- 支持图片和文件附件元数据
- 支持 CORS 域名白名单
- 支持 Vercel + Upstash 一键部署

## 架构

```text
Telegram public channel
  └─ https://t.me/s/<TG_CHANNEL>

kaaaaai.tools.channel-api on Vercel
  ├─ 抓取 Telegram 公开 HTML
  ├─ 解析消息、图片、文件、标签
  ├─ 将标准化数据存入 Upstash Redis
  └─ 通过 /api/posts 暴露给博客

Static blog
  └─ 访问时请求 /api/posts
```

## 创建 Telegram 频道

部署 API 前，先创建一个公开 Telegram Channel，并拿到频道用户名：

1. 打开 Telegram 桌面端或移动端。
2. 新建频道：`New Channel`。
3. 填写频道名称、描述和头像。
4. 选择 `Public Channel`。
5. 设置公开链接，例如 `https://t.me/my_notes`。
6. `TG_CHANNEL` 只填写用户名部分，例如 `my_notes`。
7. 至少在频道里发布一条消息。
8. 在浏览器或无痕窗口打开 `https://t.me/s/my_notes`，确认不登录也能看到内容。

注意事项：

- `TG_CHANNEL` 不要带 `@`。
- 不支持私有频道。
- 如果 `https://t.me/s/<TG_CHANNEL>` 无法公开访问，这个 API 就无法抓取频道。
- Channel 和 Group 不一样，这里需要使用适合广播发布的 Telegram Channel。

## 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKaaaaai%2Fkaaaaai.tools.channel-api&project-name=kaaaaai-tools-channel-api&repository-name=kaaaaai.tools.channel-api&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%2C%22allowConnectExistingProduct%22%3Atrue%7D%5D&env=TG_CHANNEL,ALLOWED_ORIGINS,REFRESH_SECRET&CACHE_TTL=300&PAGE_SIZE=20&MAX_FETCH_PAGES=2&POST_LIMIT=500)

Vercel 部署流程可以创建或连接 Upstash Redis，并自动注入 Redis 环境变量。

### 必填配置

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `TG_CHANNEL` | 是 | `unlimitmeme` | 公开频道用户名，不带 `@`。 |
| `REFRESH_SECRET` | 是 | `openssl rand -hex 32` | 刷新接口密钥。 |

本地生成刷新密钥：

```bash
openssl rand -hex 32
```

### 推荐配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | CORS 白名单，例如 `https://www.example.com`。 |
| `CACHE_TTL` | `300` | 缓存新鲜期，单位秒。 |
| `PAGE_SIZE` | `20` | 默认分页大小。 |
| `MAX_FETCH_PAGES` | `2` | 每次刷新抓取 Telegram 页数。 |
| `POST_LIMIT` | `500` | Redis 中最多保留消息数。 |
| `STATIC_PROXY` | 空 | 可选静态资源代理前缀。 |
| `REQUIRE_REDIS` | `false` | 为 `true` 时缺少 Redis 直接报错。 |

### Redis 环境变量

支持 Vercel KV 和 Upstash 两套命名：

```env
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

或：

```env
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

如果未配置 Redis 且 `REQUIRE_REDIS` 不是 `true`，API 会回退到内存缓存。适合本地测试，但不适合作为生产环境的稳定缓存。

## API 说明

### `GET /api/posts`

返回分页后的消息列表。

```http
GET /api/posts?page=1&page_size=20
```

响应示例：

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

从最近的消息池中随机返回一条消息。`pool_size` 默认使用 `PAGE_SIZE`，并与普通分页一样限制在 1 到 100 之间。

```http
GET /api/posts/random?pool_size=20
```

响应中的 `post` 使用与 `/api/posts` 相同的标准化消息结构；频道没有消息时为 `null`。

```json
{
  "channel": { "title": "Channel title", "description": "" },
  "post": { "id": "101", "text": "Hello" },
  "poolSize": 20,
  "generatedAt": 1760000000000,
  "fromCache": true,
  "stale": false
}
```

### `POST /api/refresh`

强制刷新 Telegram 数据。

```http
POST /api/refresh?secret=<REFRESH_SECRET>
```

可以用于定时任务、手动脚本或类 webhook 的刷新入口。

```bash
curl -X POST "https://your-channel-api.vercel.app/api/refresh?secret=$REFRESH_SECRET"
```

### `GET /api/health`

健康检查和部署配置检查。

```http
GET /api/health
```

响应示例：

```json
{
  "ok": true,
  "channel": "unlimitmeme",
  "redisConfigured": true,
  "requireRedis": false
}
```

## 接入 Hexo

在 Hexo 项目中安装配套插件：

```bash
npm install github:Kaaaaai/kaaaaai.tools.hexo-bb-channel
```

配置 `_config.yml`：

```yml
bb_channel:
  enable: true
  route: bb/
  title: 闲言碎语
  description: 这些片段可能来自于大脑皮层短暂兴奋后的捕捉 🤏
  api_base: https://your-channel-api.vercel.app
  page_size: 20
```

重新生成博客：

```bash
hexo clean
hexo generate
hexo server
```

打开 `/bb/`。

## 本地开发

```bash
npm install
npm test
```

从 `.env.example` 创建 `.env.local`：

```bash
cp .env.example .env.local
```

用 Vercel CLI 启动：

```bash
vercel dev
```

检查：

```bash
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/posts?page=1&page_size=5"
```

## 刷新策略

`GET /api/posts` 会根据 `CACHE_TTL` 判断 Redis 缓存是否新鲜。缓存过期后，服务会重新抓取 Telegram，并把最新抓取窗口与旧缓存合并。

如果希望更新更可控，可以用定时任务调用 `POST /api/refresh`：

```bash
curl -X POST "https://your-channel-api.vercel.app/api/refresh?secret=$REFRESH_SECRET"
```

## 限制

- 仅支持公开 Telegram Channel。
- 当前基于 Telegram 公开网页 HTML 解析，Telegram 页面结构变化时可能需要更新 parser。
- 暂不支持私有频道、登录态内容和受保护资源。
- Serverless 内存缓存不可靠，生产环境建议使用 Upstash Redis。

## 安全说明

- 不要把 `REFRESH_SECRET` 放到前端代码里。
- Redis 凭证只放在 Vercel 环境变量。
- 生产环境建议把 `ALLOWED_ORIGINS` 配置为真实博客域名，例如 `https://www.kaaaaai.cn`。

## 相关项目

- Hexo 插件：[Kaaaaai/kaaaaai.tools.hexo-bb-channel](https://github.com/Kaaaaai/kaaaaai.tools.hexo-bb-channel)
- 在线示例：[https://www.kaaaaai.cn/bb/](https://www.kaaaaai.cn/bb/)

## License

MIT
