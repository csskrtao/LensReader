import type { OcrPage, RangeExp, SentenceExp, WordExp } from './types';

async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 npm run dev 正在运行');
  }
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data as T;
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
