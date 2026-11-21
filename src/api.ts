import type { OcrPage, RangeExp, SentenceExp, WordExp } from './types';

const CODE_KEY = 'lensreader:access-code';

/** 同一时间只弹一次口令输入框（多张照片并行识别时会同时收到多个 401） */
let asking: Promise<string | null> | null = null;
function askAccessCode(wrong: boolean): Promise<string | null> {
  asking ??= Promise.resolve().then(() => {
    const code = window.prompt(wrong ? '访问口令错误，请重新输入：' : '请输入访问口令：')?.trim() || null;
    if (code) localStorage.setItem(CODE_KEY, code);
    asking = null;
    return code;
  });
  return asking;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    const code = localStorage.getItem(CODE_KEY);
    let r: Response;
    try {
      r = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Access-Code': code } : {}) },
        body: payload,
      });
    } catch {
      throw new Error('无法连接后端服务，请确认 npm run dev 正在运行');
    }
    const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (r.status === 401 && data.code === 'ACCESS_DENIED' && attempt < 3) {
      // 口令可能已被其他并行请求更新，先直接重试一次
      if (localStorage.getItem(CODE_KEY) !== code) continue;
      if (await askAccessCode(!!code)) continue;
      throw new Error('需要访问口令才能使用');
    }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data as T;
  }
}

export const api = {
  ocr: (image: string) => post<OcrPage>('/ocr', { image }),
  translate: (items: { id: string; text: string }[]) =>
    post<{ items: Record<string, string> }>('/translate', { items }),
  word: (word: string, sentence: string) => post<WordExp>('/explain/word', { word, sentence }),
  sentence: (sentence: string, context: string) => post<SentenceExp>('/explain/sentence', { sentence, context }),
  range: (text: string, context: string) => post<RangeExp>('/explain/range', { text, context }),
  lan: async (): Promise<{ ips: string[] }> => {
    const r = await fetch('/api/lan').catch(() => null);
    return r?.ok ? r.json() : { ips: [] };
  },
  mobileSession: () => post<{ id: string }>('/mobile/session', {}),
  mobileHello: (id: string) => post<{ ok: true; received: number }>(`/mobile/${id}/hello`, {}),
  mobileUpload: (id: string, image: string) => post<{ seq: number }>(`/mobile/${id}/upload`, { image }),
};
