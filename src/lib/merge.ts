import type { OcrPage } from '../types';

/** 句子是否完整收尾（句末标点，后面可跟引号/括号） */
const ENDED = /[.!?…]["'”’)\]]*$/;
/** 明显被截断：以逗号、破折号或连字符结尾 */
const SURELY_CUT = /[,;:\-–—]$/;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** 把跨页断开的两段句子接起来；行尾连字符断开的单词合并回去 */
function joinText(a: string, b: string): string {
  a = a.trimEnd();
  b = b.trimStart();
  if (/\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
  return a + ' ' + b;
}

function shouldJoinSentence(prev: OcrPage, cur: OcrPage, last: string, first: string): boolean {
  const t = last.trim();
  if (ENDED.test(t)) return false;
  if (SURELY_CUT.test(t)) return true;
  // 上一句没有句末标点：模型判断跨页，或下一页以小写开头，才接起来（避免把小标题和正文粘在一起）
  return !!(prev.endsMidSentence || cur.startsMidSentence || /^\p{Ll}/u.test(first.trim()));
}

/**
 * 去掉相邻两张照片重复拍到的句子：上一页末尾的 k 句 == 本页开头的 k 句。
 * 返回被删掉的句子数；paras 会被原地修改。
 */
function dropOverlap(out: string[][], paras: string[][]): { removed: number; midParagraph: boolean } {
  const tail = out.flat().slice(-5).map(norm);
  const head: { p: number; s: number; n: string }[] = [];
  paras.forEach((para, p) => para.forEach((s, i) => head.length < 5 && head.push({ p, s: i, n: norm(s) })));

  for (let k = Math.min(tail.length, head.length); k >= 1; k--) {
    const a = tail.slice(-k);
    if (a.every((n, i) => n && n === head[i].n)) {
      const lastRemoved = head[k - 1];
      // 本页第一段只删掉了一部分 → 剩下的仍属于上一页最后一段
      const midParagraph = lastRemoved.s < paras[lastRemoved.p].length - 1;
      for (let i = k - 1; i >= 0; i--) paras[head[i].p].splice(head[i].s, 1);
      return { removed: k, midParagraph };
    }
  }
  return { removed: 0, midParagraph: false };
}

/** 把多张照片的识别结果按顺序合成一篇文章 */
export function mergePages(pages: OcrPage[]): { title: string; paragraphs: string[][] } {
  const out: string[][] = [];
  let title = '';
  let prev: OcrPage | null = null;

  for (const page of pages) {
    const paras = page.paragraphs.map((p) => p.map((s) => s.trim()).filter(Boolean)).filter((p) => p.length);
    if (!paras.length) continue;
    if (!title && page.title) title = page.title;

    if (!prev || !out.length) {
      out.push(...paras);
      prev = page;
      continue;
    }

    const lastPara = out[out.length - 1];
    const last = lastPara[lastPara.length - 1];
    /** 本页剩下的第一段是否是上一页最后一段的延续 */
    let joinPara = false;

    // 情况 1：上一页最后半句在本页开头又被完整拍到了一次 → 用完整的那句替换
    const firstNorm = norm(paras[0][0]);
    if (!ENDED.test(last.trim()) && norm(last) && firstNorm.startsWith(norm(last)) && firstNorm !== norm(last)) {
      lastPara[lastPara.length - 1] = paras[0].shift()!;
      joinPara = paras[0].length > 0;
    } else {
      // 情况 2：两张照片有重叠的整句
      const ov = dropOverlap(out, paras);
      if (ov.removed) {
        joinPara = ov.midParagraph;
      } else if (shouldJoinSentence(prev, page, last, paras[0][0])) {
        // 情况 3：句子跨页断开 → 接成一句，并且必然同属一段
        lastPara[lastPara.length - 1] = joinText(last, paras[0].shift()!);
        joinPara = paras[0].length > 0;
      } else {
        // 情况 4：句子完整，仅段落跨页
        joinPara = !!(page.startsMidParagraph || prev.endsMidParagraph);
      }
    }

    const rest = paras.filter((p) => p.length);
    if (joinPara && rest.length) lastPara.push(...rest.shift()!);
    out.push(...rest);
    prev = page;
  }

  return { title, paragraphs: out };
}

/** 并发受限地逐个处理，保持结果顺序 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
