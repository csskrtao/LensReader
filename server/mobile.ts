import type { Express, Response } from 'express';
import crypto from 'node:crypto';
import os from 'node:os';
import { ACCESS_DENIED, ACCESS_HEADER, checkAccess } from './routes';

/** 手机扫码拍照 → 电脑网页：会话保存在内存，图片经 SSE 推给电脑端 */

interface Session {
  pcClients: Set<Response>;
  queue: { seq: number; image: string }[]; // 电脑端不在线时暂存
  seq: number;
  phoneSeen: boolean;
  lastActive: number;
}

const sessions = new Map<string, Session>();
const IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.pcClients.size === 0 && now - s.lastActive > IDLE_MS) sessions.delete(id);
  }
}, 60 * 1000).unref();

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(s: Session, event: string, data: unknown) {
  for (const res of s.pcClients) send(res, event, data);
}

const isPrivate = (ip: string) =>
  ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
const isVirtual = (name: string, ip: string) =>
  /vethernet|vmware|virtualbox|vbox|wsl|hyper-v|docker|loopback|tailscale|zerotier|mihomo|clash|wintun|\btun\b|sing-box|v2ray/i.test(name) ||
  /^198\.1[89]\./.test(ip); // 代理软件 TUN 网卡常用的 fake-ip 段
const isPhysical = (name: string) => /wlan|wi-?fi|无线|以太网|ethernet|^en\d|^eth\d|^wl/i.test(name);

function lanIps(): string[] {
  const list: { ip: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (isPrivate(a.address)) score += 2;
      if (a.address.startsWith('192.168.')) score += 1;
      if (isPhysical(name)) score += 2;
      if (isVirtual(name, a.address)) score -= 6;
      list.push({ ip: a.address, score });
    }
  }
  return list.sort((x, y) => y.score - x.score).map((x) => x.ip);
}

export function mountMobile(app: Express, accessCode?: string) {
  app.get('/api/lan', (_req, res) => {
    res.json({ ips: lanIps() });
  });

  app.post('/api/mobile/session', (req, res) => {
    if (!checkAccess(accessCode, req.get(ACCESS_HEADER))) {
      res.status(401).json(ACCESS_DENIED);
      return;
    }
    const id = crypto.randomUUID();
    sessions.set(id, { pcClients: new Set(), queue: [], seq: 0, phoneSeen: false, lastActive: Date.now() });
    res.json({ id });
  });

  app.get('/api/mobile/:id/events', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) {
      res.status(404).json({ error: '会话不存在' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    s.pcClients.add(res);
    s.lastActive = Date.now();
    send(res, 'ready', { phone: s.phoneSeen });
    // 补发电脑端离线期间收到的照片
    for (const item of s.queue.splice(0)) send(res, 'image', item);

    const ping = setInterval(() => res.write(': ping\n\n'), 25 * 1000);
    req.on('close', () => {
      clearInterval(ping);
      s.pcClients.delete(res);
      s.lastActive = Date.now();
    });
  });

  app.post('/api/mobile/:id/hello', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) {
      res.status(404).json({ error: '二维码已失效，请在电脑上重新打开「手机拍照」' });
      return;
    }
    s.phoneSeen = true;
    s.lastActive = Date.now();
    broadcast(s, 'phone', {});
    res.json({ ok: true, received: s.seq });
  });

  app.post('/api/mobile/:id/upload', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) {
      res.status(404).json({ error: '二维码已失效，请在电脑上重新打开「手机拍照」' });
      return;
    }
    const image = req.body?.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      res.status(400).json({ error: 'image 必须是图片 data URL' });
      return;
    }
    s.lastActive = Date.now();
    s.phoneSeen = true;
    const item = { seq: ++s.seq, image };
    if (s.pcClients.size) broadcast(s, 'image', item);
    else s.queue.push(item);
    res.json({ seq: item.seq });
  });
}
