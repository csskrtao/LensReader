import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * 手机扫码拍照 → 电脑网页（Cloudflare 版，对应本地的 server/mobile.ts）。
 * 每个会话一个 Durable Object：电脑端用 SSE 连上来，手机上传的图片经它推给电脑；
 * 电脑端暂时不在线时，图片存进 Durable Object 存储，重连后补发。
 */

interface Meta {
  seq: number;
  phoneSeen: boolean;
}
interface Item {
  seq: number;
  image: string;
}

const IDLE_MS = 30 * 60 * 1000;
const EXPIRED = '二维码已失效，请在电脑上重新打开「手机拍照」';
const enc = new TextEncoder();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export class MobileSession extends DurableObject<Env> {
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private memQueue: Item[] = []; // 存储写不下（单个值超过上限）时的兜底
  private ping: ReturnType<typeof setInterval> | null = null;

  async fetch(req: Request): Promise<Response> {
    const action = new URL(req.url).pathname.split('/').pop();
    const storage = this.ctx.storage;

    if (action === 'init') {
      await storage.put<Meta>('meta', { seq: 0, phoneSeen: false });
      await this.touch();
      return json({ ok: true });
    }

    const meta = await storage.get<Meta>('meta');
    if (!meta) return json({ error: action === 'events' ? '会话不存在' : EXPIRED }, 404);
    await this.touch();

    if (action === 'events' && req.method === 'GET') return this.openEvents(meta);

    if (action === 'hello' && req.method === 'POST') {
      meta.phoneSeen = true;
      await storage.put('meta', meta);
      await this.broadcast('phone', {});
      return json({ ok: true, received: meta.seq });
    }

    if (action === 'upload' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
      const image = body?.image;
      if (typeof image !== 'string' || !image.startsWith('data:image/')) {
        return json({ error: 'image 必须是图片 data URL' }, 400);
      }
      meta.seq += 1;
      meta.phoneSeen = true;
      await storage.put('meta', meta);
      const item: Item = { seq: meta.seq, image };
      const delivered = await this.broadcast('image', item);
      if (!delivered) {
        try {
          await storage.put(`q:${String(item.seq).padStart(6, '0')}`, item);
        } catch {
          this.memQueue.push(item);
        }
      }
      return json({ seq: item.seq });
    }

    return json({ error: 'Not found' }, 404);
  }

  private async openEvents(meta: Meta): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.clients.add(writer);

    // 先把 ready 和离线期间的照片写进去（不 await：响应返回后浏览器才开始读）
    const stored = await this.ctx.storage.list<Item>({ prefix: 'q:' });
    const backlog = [...stored.values(), ...this.memQueue.splice(0)].sort((a, b) => a.seq - b.seq);
    if (stored.size) await this.ctx.storage.delete([...stored.keys()]);
    void (async () => {
      await this.write(writer, 'ready', { phone: meta.phoneSeen });
      for (const item of backlog) await this.write(writer, 'image', item);
    })();

    if (!this.ping) {
      this.ping = setInterval(() => {
        for (const w of this.clients) w.write(enc.encode(': ping\n\n')).catch(() => this.drop(w));
        if (!this.clients.size && this.ping) {
          clearInterval(this.ping);
          this.ping = null;
        }
      }, 25 * 1000);
    }

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  private async write(w: WritableStreamDefaultWriter<Uint8Array>, event: string, data: unknown): Promise<boolean> {
    try {
      await w.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      return true;
    } catch {
      this.drop(w);
      return false;
    }
  }

  /** 推给所有在线的电脑端，返回成功送达的数量 */
  private async broadcast(event: string, data: unknown): Promise<number> {
    const ok = await Promise.all([...this.clients].map((w) => this.write(w, event, data)));
    return ok.filter(Boolean).length;
  }

  private drop(w: WritableStreamDefaultWriter<Uint8Array>) {
    this.clients.delete(w);
    w.close().catch(() => {});
  }

  /** 每次有活动都把清理时间往后推 */
  private touch() {
    return this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  async alarm() {
    if (this.clients.size) await this.touch();
    else await this.ctx.storage.deleteAll();
  }
}
