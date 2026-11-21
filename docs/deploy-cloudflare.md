# 部署到 Cloudflare Workers

LensReader 可以整体部署成一个 Cloudflare Worker：前端页面、AI 接口和手机拍照会话都在同一个域名下，不需要自己的服务器。

## 架构

| 部分 | 本地（`npm run dev` / `npm start`） | Cloudflare |
|---|---|---|
| 前端页面 | Vite / Express 托管 `dist/` | Workers 静态资源（`assets`） |
| AI 接口 `/api/ocr`、`/api/translate`、`/api/explain/*` | `server/index.ts`（Express） | `worker/index.ts` |
| 接口逻辑、提示词 | `server/routes.ts`、`server/prompts.ts`、`server/llm.ts`（两边共用） | 同左 |
| 手机拍照会话 | `server/mobile.ts`（内存 + SSE） | `worker/mobile.ts`（Durable Object + SSE） |
| 二维码地址 | 局域网 IP，手机需连同一 WiFi | 当前域名，手机用流量也能用 |

请求路由：`/api/*` 先进入 Worker（`run_worker_first`），其余路径返回静态资源，找不到的路径回退到 `index.html`（单页应用）。

## 准备

- 一个 Cloudflare 账号（免费套餐即可，Durable Object 用的是免费套餐支持的 SQLite 存储）
- 如需自定义域名：域名已托管在该 Cloudflare 账号下
- 已执行过 `npm install`（会安装 `wrangler`）

## 首次部署

### 1. 登录 Cloudflare

```bash
npx wrangler login      # 打开浏览器授权，点 Allow
npx wrangler whoami     # 确认登录的账号
```

### 2. 检查 `wrangler.jsonc`

```jsonc
{
  "name": "lensreader",                 // Worker 名称
  "vars": {
    "VISION_MODEL": "...",              // 识图模型，必须支持图片输入
    "TEXT_MODEL": "..."                 // 讲解 / 翻译模型
  },
  "routes": [{ "pattern": "lensreader.example.com", "custom_domain": true }]
}
```

- `routes` 改成你自己的域名；不想用自定义域名就删掉 `routes`，并加上 `"workers_dev": true`，会得到 `lensreader.<账号子域>.workers.dev` 的地址
- 注意：`*.workers.dev` 在国内大陆访问不稳定，国内使用建议绑定自定义域名
- 自定义域名会自动创建 DNS 记录和证书，不需要手动去 DNS 面板添加

### 3. 部署

```bash
npm run deploy          # = vite build && wrangler deploy
```

### 4. 设置密钥

密钥不写进任何文件，用命令设置（每条会提示输入值）：

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL     # OpenAI 官方可跳过
npx wrangler secret put ACCESS_CODE         # 访问口令，强烈建议设置
```

也可以一次性导入（文件用完立即删除，不要放在项目目录里）：

```bash
# secrets.json: {"OPENAI_API_KEY": "...", "OPENAI_BASE_URL": "...", "ACCESS_CODE": "..."}
npx wrangler secret bulk secrets.json
```

密钥设置后立即生效，不需要重新部署。

### 5. 验证

```bash
# 不带口令应返回 401 {"error":"访问口令错误","code":"ACCESS_DENIED"}
curl -X POST https://你的域名/api/translate -H "Content-Type: application/json" \
  -d '{"items":[{"id":"a","text":"Hello."}]}'

# 带口令应返回译文
curl -X POST https://你的域名/api/translate -H "Content-Type: application/json" \
  -H "X-Access-Code: 你的口令" -d '{"items":[{"id":"a","text":"Hello."}]}'
```

然后在浏览器打开域名，上传一张照片试一下完整流程，再用手机扫码试拍照上传。

## 日常维护

| 要做的事 | 命令 |
|---|---|
| 更新代码 | `npm run deploy` |
| 改模型 | 改 `wrangler.jsonc` 的 `vars`，然后 `npm run deploy` |
| 改访问口令 | `npx wrangler secret put ACCESS_CODE`（立即生效；用户下次使用时会被提示重新输入） |
| 换 API Key / 接口地址 | `npx wrangler secret put OPENAI_API_KEY` / `OPENAI_BASE_URL` |
| 查看已设置的密钥名 | `npx wrangler secret list` |
| 看实时日志 | `npx wrangler tail` |
| 回滚到之前的版本 | `npx wrangler rollback` |

## 访问口令说明

- 设置了 `ACCESS_CODE` 后，识别、翻译、讲解接口和「创建手机拍照会话」都要求请求头 `X-Access-Code` 与口令一致
- 网页第一次调用接口时会弹窗要求输入，口令保存在浏览器 localStorage（按域名区分），之后不再询问；口令错误会再次弹窗
- 手机扫码上传不需要口令：二维码里的会话 id 是电脑端（已通过口令）创建的随机 UUID，本身就是凭证；会话 30 分钟无活动后自动清除
- 不设置 `ACCESS_CODE` 则不校验——部署在公网上时，任何人都能用你的 API Key，不建议

## 本地模拟 Cloudflare 环境

```bash
# .dev.vars（格式同 .env，已被 git 忽略）
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
ACCESS_CODE=...

npm run cf:dev          # = vite build && wrangler dev，访问 http://localhost:8787
```

注意 `wrangler dev` 默认也用 8787 端口，和 `npm start` 不要同时运行；可以用 `npx wrangler dev --port 8788` 换端口。

## 限制与注意

- 照片在浏览器端压缩到最长边 2000px 后上传，远低于 Workers 的请求体上限（免费套餐 100MB）
- 识别一页通常需要几十秒；Worker 等待模型返回的时间不计入 CPU 时间，不会超时
- 电脑端断开期间手机上传的照片会存进 Durable Object，重连后补发；单张超过 2MB 的照片退回到内存暂存
- 所有文章、生词本、历史记录仍保存在用户自己浏览器的 localStorage 中，服务端不保存
