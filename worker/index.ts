/** Cloudflare Worker 入口：/api/* 由这里处理，其余请求交给静态资源（dist/） */
import { createLLM } from '../server/llm';
import { ACCESS_DENIED, ACCESS_HEADER, checkAccess, routes } from '../server/routes';
import type { Env } from './env';

export { MobileSession } from './mobile';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const MOBILE_RE = /^\/mobile\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(events|hello|upload)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const p = url.pathname.slice('/api'.length);
    const allowed = () => checkAccess(env.ACCESS_CODE, req.headers.get(ACCESS_HEADER));

    // 线上部署时二维码直接用当前域名，不需要局域网 IP
    if (p === '/lan') return json({ ips: [] });

    if (p === '/mobile/session' && req.method === 'POST') {
      if (!allowed()) return json(ACCESS_DENIED, 401);
      const id = crypto.randomUUID();
      const stub = env.MOBILE.get(env.MOBILE.idFromName(id));
      await stub.fetch('https://mobile/init', { method: 'POST' });
      return json({ id });
    }

    const m = p.match(MOBILE_RE);
    if (m) return env.MOBILE.get(env.MOBILE.idFromName(m[1])).fetch(req);

    const handler = routes[p];
    if (!handler || req.method !== 'POST') return json({ error: 'Not found' }, 404);
    if (!allowed()) return json(ACCESS_DENIED, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: '请求体必须是 JSON' }, 400);
    const llm = createLLM({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      textModel: env.TEXT_MODEL,
      visionModel: env.VISION_MODEL,
    });
    try {
      return json(await handler(body, llm));
    } catch (e: any) {
      console.error(`[${p}]`, e?.message || e);
      return json({ error: e?.message || String(e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
