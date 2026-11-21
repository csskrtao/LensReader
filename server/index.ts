import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { callJSON, textModel, visionModel } from './llm';
import { mountMobile } from './mobile';
import * as P from './prompts';

const app = express();
app.use(express.json({ limit: '20mb' }));
mountMobile(app);

type Handler = (body: any) => Promise<any>;

function route(p: string, handler: Handler) {
  app.post('/api' + p, async (req, res) => {
    try {
      res.json(await handler(req.body || {}));
    } catch (e: any) {
      console.error(`[${p}]`, e?.message || e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}

const str = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`缺少参数 ${name}`);
  return v.trim();
};

route(
  '/ocr',
  async (b) => {
    const image = str(b.image, 'image');
    if (!image.startsWith('data:image/')) throw new Error('image 必须是 data URL');
    const r = await callJSON(visionModel(), [
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
);

route(
  '/translate',
  async (b) => {
    const items = (Array.isArray(b.items) ? b.items : []) as { id: string; text: string }[];
    if (!items.length) throw new Error('缺少参数 items');
    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 30) chunks.push(items.slice(i, i + 30));
    const results = await Promise.all(
      chunks.map((chunk) =>
        callJSON(textModel(), [
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
);

route(
  '/explain/word',
  (b) =>
    callJSON(textModel(), [
      { role: 'system', content: P.WORD_PROMPT },
      { role: 'user', content: `单词：${str(b.word, 'word')}\n所在句子：${str(b.sentence, 'sentence')}` },
    ]),
);

route(
  '/explain/sentence',
  (b) =>
    callJSON(textModel(), [
      { role: 'system', content: P.SENTENCE_PROMPT },
      {
        role: 'user',
        content: `要讲解的句子：${str(b.sentence, 'sentence')}\n上下文：${typeof b.context === 'string' ? b.context : ''}`,
      },
    ]),
);

route(
  '/explain/range',
  (b) =>
    callJSON(textModel(), [
      { role: 'system', content: P.RANGE_PROMPT },
      { role: 'user', content: `划线内容：${str(b.text, 'text')}\n所在句子：${str(b.context, 'context')}` },
    ]),
);

// 生产模式：托管 vite build 的产物
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(dist, 'index.html'));
    else next();
  });
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(
    `[server] http://localhost:${port}  base=${process.env.OPENAI_BASE_URL || 'OpenAI'} vision=${visionModel()} text=${textModel()}`,
  );
});
