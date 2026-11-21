/** 与运行环境无关的 AI 接口：本地 Express（server/index.ts）和 Cloudflare Worker（worker/index.ts）共用 */
import type { LLM } from './llm';
import * as P from './prompts';
import { QUICK_BATCH, quickTranslate, quickWord } from './quick';

export type Handler = (body: any, llm: LLM) => Promise<any>;

const str = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`缺少参数 ${name}`);
  return v.trim();
};

export const routes: Record<string, Handler> = {
  '/ocr': async (b, llm) => {
    const image = str(b.image, 'image');
    if (!image.startsWith('data:image/')) throw new Error('image 必须是 data URL');
    const r = await llm.callJSON(llm.visionModel, [
      { role: 'system', content: P.OCR_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: 'Transcribe the English article in this image and return the JSON.' },
        ],
      },
    ]);
    const paragraphs = (Array.isArray(r?.paragraphs) ? r.paragraphs : [])
      .map((p: unknown) => (Array.isArray(p) ? p : [p]))
      .map((p: unknown[]) => p.map((s) => String(s ?? '').trim()).filter(Boolean))
      .filter((p: string[]) => p.length > 0);
    return {
      title: String(r?.title || '').trim(),
      paragraphs,
      startsMidSentence: r?.starts_mid_sentence === true,
      startsMidParagraph: r?.starts_mid_paragraph === true,
      endsMidSentence: r?.ends_mid_sentence === true,
      endsMidParagraph: r?.ends_mid_paragraph === true,
    };
  },

  '/translate': async (b, llm) => {
    const items = (Array.isArray(b.items) ? b.items : []) as { id: string; text: string }[];
    if (!items.length) throw new Error('缺少参数 items');
    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 30) chunks.push(items.slice(i, i + 30));
    const results = await Promise.all(
      chunks.map((chunk) =>
        llm.callJSON(llm.textModel, [
          { role: 'system', content: P.TRANSLATE_PROMPT },
          { role: 'user', content: JSON.stringify(chunk) },
        ]),
      ),
    );
    const out: Record<string, string> = {};
    for (const r of results) {
      for (const it of Array.isArray(r?.items) ? r.items : []) {
        if (it && it.id != null) out[String(it.id)] = String(it.zh ?? '');
      }
    }
    return { items: out };
  },

  '/explain/word': (b, llm) =>
    llm.callJSON(llm.textModel, [
      { role: 'system', content: P.WORD_PROMPT },
      { role: 'user', content: `单词：${str(b.word, 'word')}\n所在句子：${str(b.sentence, 'sentence')}` },
    ]),

  '/explain/sentence': (b, llm) =>
    llm.callJSON(llm.textModel, [
      { role: 'system', content: P.SENTENCE_PROMPT },
      {
        role: 'user',
        content: `要讲解的句子：${str(b.sentence, 'sentence')}\n上下文：${typeof b.context === 'string' ? b.context : ''}`,
      },
    ]),

  '/explain/range': (b, llm) =>
    llm.callJSON(llm.textModel, [
      { role: 'system', content: P.RANGE_PROMPT },
      { role: 'user', content: `划线内容：${str(b.text, 'text')}\n所在句子：${str(b.context, 'context')}` },
    ]),

  // 快速结果（词典 / 机翻），不经过 AI
  '/quick/word': (b) => quickWord(str(b.word, 'word')),

  '/quick/translate': async (b) => {
    const items = (Array.isArray(b.items) ? b.items : []) as { id: string; text: string }[];
    if (!items.length) throw new Error('缺少参数 items');
    if (items.length > QUICK_BATCH) throw new Error(`items 单次最多 ${QUICK_BATCH} 条`);
    return { items: await quickTranslate(items) };
  },
};

/**
 * 访问口令：设置了 ACCESS_CODE 时，AI 接口和创建手机会话都要求请求头 X-Access-Code 一致。
 * 手机端的 hello / upload / events 不校验：会话 id 是电脑端（已通过口令）创建的随机 UUID，本身就是凭证。
 */
export const ACCESS_HEADER = 'x-access-code';

export function checkAccess(expected: string | undefined, given: string | null | undefined): boolean {
  if (!expected) return true;
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export const ACCESS_DENIED = { error: '访问口令错误', code: 'ACCESS_DENIED' };
