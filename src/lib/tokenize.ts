import type { Doc, Sentence, Token } from '../types';

// 单词（允许内部撇号/连字符，如 don't、well-known）| 空白 | 单个标点
const RE = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|(\s+)|([^\s\p{L}\p{N}])/gu;

export function buildDoc(paragraphs: string[][]): Doc {
  const tokens: Token[] = [];
  const sentences = new Map<string, Sentence>();
  const order: Sentence[] = [];
  const out: Sentence[][] = [];

  paragraphs.forEach((para, p) => {
    const row: Sentence[] = [];
    para.forEach((raw, s) => {
      const text = raw.trim();
      const sid = `${p}-${s}`;
      const start = tokens.length;
      for (const m of text.matchAll(RE)) {
        if (m[2]) {
          if (tokens.length > start) tokens[tokens.length - 1].ws += ' ';
          continue;
        }
        tokens.push({ i: tokens.length, text: m[0], ws: '', isWord: !!m[1], sid });
      }
      if (tokens.length === start) return;
      const sen: Sentence = { id: sid, text, start, end: tokens.length - 1 };
      row.push(sen);
      order.push(sen);
      sentences.set(sid, sen);
    });
    if (row.length) out.push(row);
  });

  return { paragraphs: out, order, tokens, sentences };
}

/** 取 [start, end] 范围内的原文 */
export function textOf(doc: Doc, start: number, end: number): string {
  let t = '';
  for (let i = start; i <= end; i++) {
    const tok = doc.tokens[i];
    t += tok.text;
    if (i < end) t += tok.ws || (tok.sid !== doc.tokens[i + 1].sid ? ' ' : '');
  }
  return t.trim();
}

/** [start, end] 所覆盖的所有句子拼成的文本 */
export function contextOf(doc: Doc, start: number, end: number): string {
  const a = doc.order.findIndex((s) => s.id === doc.tokens[start].sid);
  const b = doc.order.findIndex((s) => s.id === doc.tokens[end].sid);
  return doc.order
    .slice(a, b + 1)
    .map((s) => s.text)
    .join(' ');
}

/** 句子及其前后各一句 */
export function surroundingOf(doc: Doc, sid: string): string {
  const k = doc.order.findIndex((s) => s.id === sid);
  return doc.order
    .slice(Math.max(0, k - 1), k + 2)
    .map((s) => s.text)
    .join(' ');
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
